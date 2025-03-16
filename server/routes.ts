import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { generateAIResponse, generateAIBackground } from "./openai";
import { parse as parseCookie } from "cookie";
import { getSession } from "./sessionStore";

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: "/ws",
    verifyClient: async (info, done) => {
      try {
        // Parse the session cookie
        const cookies = parseCookie(info.req.headers.cookie || '');
        const sid = cookies['sid'];

        if (!sid) {
          done(false, 401, 'Unauthorized: No session cookie');
          return;
        }

        // Get session from shared session store
        const session = await getSession(sid);

        if (!session?.passport?.user) {
          done(false, 401, 'Unauthorized: Invalid session');
          return;
        }

        // Attach session to request for later use
        (info.req as any).session = session;
        done(true);
      } catch (error) {
        console.error('WebSocket authentication error:', error);
        done(false, 500, 'Internal server error');
      }
    }
  });

  wss.on('connection', (ws, req) => {
    const session = (req as any).session;
    const userId = session?.passport?.user;
    
    console.log(`WebSocket connection established for user: ${userId}`);

    // Send initial confirmation message
    try {
      ws.send(JSON.stringify({ type: 'connected', userId }));
    } catch (error) {
      console.error(`Error sending initial message to user ${userId}:`, error);
    }

    // Handle errors with more detail
    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
    });

    // Handle pings from client to keep connection alive
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          console.log(`Ping-pong exchange with user ${userId}`);
        }
      } catch (error) {
        console.error(`Error processing WebSocket message from user ${userId}:`, error);
      }
    });

    // Server-side ping to keep the connection alive (more frequent)
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'server-ping' }));
        } catch (error) {
          console.error(`Error sending ping to user ${userId}:`, error);
        }
      } else if (ws.readyState !== ws.CONNECTING) {
        console.log(`Clearing interval for disconnected user ${userId}`);
        clearInterval(pingInterval);
      }
    }, 15000); // More frequent pings

    ws.on('close', (code, reason) => {
      console.log(`WebSocket connection closed for user ${userId}:`, code, reason.toString());
      clearInterval(pingInterval);
    });
  });

  // Broadcast AI interactions to all connected clients
  function broadcastInteraction(interaction: any) {
    const messageStr = JSON.stringify(interaction);
    let sentCount = 0;
    let closedCount = 0;
    
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) { // WebSocket.OPEN = 1
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error('Error sending WebSocket message:', error);
          // Try to close problematic connections
          try {
            client.close(1011, "Error sending message");
            closedCount++;
          } catch (closeError) {
            console.error('Error closing problematic WebSocket:', closeError);
          }
        }
      } else if (client.readyState === client.CLOSED || client.readyState === client.CLOSING) {
        closedCount++;
      }
    });
    
    console.log(`Broadcast interaction to ${sentCount} clients (${closedCount} closed/closing):`, {
      type: interaction.type || 'interaction',
      id: interaction.id,
      postId: interaction.postId
    });
  }

  app.post("/api/posts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const post = await storage.createPost(req.user!.id, req.body.content);

    // Get AI followers for the user
    const followers = await storage.getAiFollowers(req.user!.id);

    // Generate AI responses
    for (const follower of followers) {
      try {
        const aiResponse = await generateAIResponse(post.content, follower.personality);

        if (aiResponse.confidence > 0.7) {
          const interaction = await storage.createAiInteraction({
            postId: post.id,
            aiFollowerId: follower.id,
            type: aiResponse.type || 'comment',
            content: aiResponse.content || null,
            parentId: null,
          });

          const fullInteraction = {
            ...interaction,
            aiFollower: follower,
          };

          broadcastInteraction(fullInteraction);
        }
      } catch (error) {
        console.error(`AI follower ${follower.id} failed to respond:`, error);
      }
    }

    res.status(201).json(post);
  });

  app.get("/api/posts/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const posts = await storage.getUserPosts(parseInt(req.params.userId));
    const postsWithInteractions = await Promise.all(
      posts.map(async (post) => {
        // Get all interactions for this post
        const interactions = await storage.getPostInteractions(post.id);

        // Create a map to store interactions by their ID
        const interactionMap = new Map();

        // First pass: create interaction objects with their AI follower info
        await Promise.all(
          interactions.map(async (interaction) => {
            const aiFollower = interaction.aiFollowerId ? 
              await storage.getAiFollower(interaction.aiFollowerId) 
              : null;

            interactionMap.set(interaction.id, {
              ...interaction,
              aiFollower,
              replies: []
            });
          })
        );

        // Second pass: organize into threads
        const threadedInteractions = [];
        interactions.forEach(interaction => {
          const interactionWithData = interactionMap.get(interaction.id);

          if (interaction.parentId === null) {
            // This is a top-level interaction
            threadedInteractions.push(interactionWithData);
          } else {
            // This is a reply, add it to its parent's replies array
            const parent = interactionMap.get(interaction.parentId);
            if (parent) {
              parent.replies.push(interactionWithData);
            }
          }
        });

        // Sort replies by timestamp within each thread
        threadedInteractions.forEach(interaction => {
          if (interaction.replies) {
            interaction.replies.sort((a, b) => 
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          }
        });

        return {
          ...post,
          interactions: threadedInteractions
        };
      })
    );

    res.json(postsWithInteractions);
  });

  app.post("/api/posts/:postId/reply", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { content, parentId } = req.body;
    const postId = parseInt(req.params.postId);

    try {
        // First, get the parent interaction and its AI follower
        const parentInteraction = await storage.getInteraction(parentId);
        if (!parentInteraction) {
            return res.status(404).json({ message: "Parent interaction not found" });
        }

        const aiFollower = parentInteraction.aiFollowerId ? 
            await storage.getAiFollower(parentInteraction.aiFollowerId)
            : null;
        if (!aiFollower) {
            return res.status(404).json({ message: "AI follower not found" });
        }

        // Save the user's reply first
        const userReply = await storage.createAiInteraction({
            postId,
            userId: req.user!.id,
            aiFollowerId: null,
            type: "reply",
            content,
            parentId,
        });

        // Generate AI response to the user's reply
        const aiResponse = await generateAIResponse(
            content,
            aiFollower.personality,
            parentInteraction.content
        );

        if (aiResponse.confidence > 0.7) {
            // Save the AI's response
            const aiReply = await storage.createAiInteraction({
                postId,
                aiFollowerId: aiFollower.id,
                userId: null,
                type: "reply",
                content: aiResponse.content || null,
                parentId,
            });

            // Get all interactions for this thread
            const interactions = await storage.getPostInteractions(postId);
            const interactionMap = new Map();

            // Build interaction map with AI follower info
            await Promise.all(
                interactions.map(async (inter) => {
                    const follower = inter.aiFollowerId ? 
                        await storage.getAiFollower(inter.aiFollowerId) 
                        : null;

                    interactionMap.set(inter.id, {
                        ...inter,
                        aiFollower: follower,
                        replies: []
                    });
                })
            );

            // Organize into threads
            const threadedInteractions = [];
            interactions.forEach(inter => {
                const interWithData = interactionMap.get(inter.id);

                if (inter.parentId === null) {
                    threadedInteractions.push(interWithData);
                } else {
                    const parent = interactionMap.get(inter.parentId);
                    if (parent) {
                        parent.replies.push(interWithData);
                    }
                }
            });

            // Sort replies by timestamp
            threadedInteractions.forEach(inter => {
                if (inter.replies) {
                    inter.replies.sort((a, b) => 
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    );
                }
            });

            // Find the complete thread containing our replies
            const parentThread = threadedInteractions.find(
                inter => inter.id === parentId || inter.replies.some(reply => reply.id === parentId)
            );

            if (!parentThread) {
                return res.status(500).json({ message: "Failed to construct reply thread" });
            }

            // Broadcast thread update to all connected clients
            broadcastInteraction({
                type: 'thread-update',
                postId,
                thread: parentThread
            });

            res.status(201).json(parentThread);
        } else {
            res.status(400).json({ message: "AI couldn't generate a confident response" });
        }
    } catch (error) {
        console.error("Error handling reply:", error);
        res.status(500).json({ message: "Failed to process reply" });
    }
  });

  app.post("/api/followers", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Generate AI background based on name and personality
      const aiBackground = await generateAIBackground(
        req.body.name,
        req.body.personality
      );

      // Create follower with the generated background
      const follower = await storage.createAiFollower(req.user!.id, {
        name: req.body.name,
        personality: req.body.personality,
        avatarUrl: req.body.avatarUrl,
        background: aiBackground.background,
        interests: aiBackground.interests,
        communicationStyle: aiBackground.communication_style,
        interactionPreferences: aiBackground.interaction_preferences,
      });

      res.status(201).json(follower);
    } catch (error) {
      console.error("Error creating AI follower:", error);
      res.status(500).json({ message: "Failed to create AI follower" });
    }
  });

  app.get("/api/followers", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const followers = await storage.getAiFollowers(req.user!.id);
    res.json(followers);
  });

  return httpServer;
}