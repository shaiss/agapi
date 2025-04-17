import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth, hasCirclePermission } from './middleware';
import { ResponseScheduler } from '../response-scheduler';
import { ThreadContextManager } from '../context-manager';
import { ThreadManager } from '../thread-manager';

const router = Router();
const contextManager = ThreadContextManager.getInstance(); 

/**
 * POST /api/posts/test-pending-response - Test endpoint to create a pending response
 */
router.post('/test-pending-response', async (req, res) => {
  try {
    const { postId, followerId, delayMinutes = 5 } = req.body;
    
    if (!postId || !followerId) {
      return res.status(400).json({ message: "Missing required parameters: postId and followerId are required" });
    }
    
    // Get the post and follower
    const post = await storage.getPost(postId);
    const follower = await storage.getAiFollower(followerId);
    
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    
    if (!follower) {
      return res.status(404).json({ message: "AI follower not found" });
    }
    
    // Calculate scheduled time
    const scheduledTime = new Date();
    scheduledTime.setMinutes(scheduledTime.getMinutes() + Number(delayMinutes));
    
    // Create pending response
    const pendingResponse = await storage.createPendingResponse({
      postId,
      aiFollowerId: followerId,
      scheduledFor: scheduledTime,
    });
    
    res.status(200).json({
      message: "Pending response created successfully",
      pendingResponse
    });
  } catch (error) {
    console.error("Error creating test pending response:", error);
    res.status(500).json({ message: "Failed to create test pending response" });
  }
});

/**
 * GET /api/posts - Get posts from circles the user has access to
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get user's circles and circles the user is a member of
    const userCircles = await storage.getUserCircles(req.user!.id);
    const circleIds = [
      ...userCircles.owned.map(c => c.id),
      ...userCircles.shared.map(c => c.id)
    ];
    
    // Get posts from these circles
    const allPosts = [];
    
    for (const circleId of circleIds) {
      const circlePosts = await storage.getCirclePosts(circleId);
      // Add circle info to each post
      const circle = await storage.getCircle(circleId);
      const postsWithCircle = circlePosts.map(post => ({
        ...post,
        circle
      }));
      allPosts.push(...postsWithCircle);
    }
    
    // Sort by created date, most recent first
    allPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    res.json(allPosts);
  } catch (error) {
    console.error("Error getting all posts:", error);
    res.status(500).json({ message: "Failed to get posts" });
  }
});

/**
 * GET /api/posts/:id - Get a specific post by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    return res.status(400).json({ message: "Invalid post ID" });
  }
  
  try {
    // Get the post
    const post = await storage.getPost(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    
    // Check if the user has access to the circle this post belongs to
    const hasPermission = await hasCirclePermission(post.circleId, req.user!.id, storage);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    // Get interactions for this post
    const interactions = await storage.getPostInteractions(postId);
    
    // Get user info for each interaction
    const interactionsWithUsers = await Promise.all(
      interactions.map(async (interaction) => {
        if (interaction.userType === "ai") {
          const follower = await storage.getAiFollower(interaction.authorId);
          return {
            ...interaction,
            author: follower,
            aiFollower: follower // Add aiFollower property for Comment component compatibility
          };
        } else {
          const user = await storage.getUser(interaction.authorId);
          return {
            ...interaction,
            author: user
          };
        }
      })
    );
    
    // Get thread structure
    const threads = await ThreadManager.getThreadedInteractions(postId);
    
    // Get pending responses
    const pendingResponses = await storage.getPostPendingResponses(postId);
    
    // Format pending responses
    const formattedPendingResponses = await Promise.all(
      pendingResponses.map(async (pr) => {
        let followerName = "AI";
        let followerAvatarUrl = "";
        
        if (pr.aiFollowerId) {
          const follower = await storage.getAiFollower(pr.aiFollowerId);
          if (follower) {
            followerName = follower.name;
            followerAvatarUrl = follower.avatarUrl;
          }
        }
        
        return {
          id: pr.id,
          name: followerName,
          avatarUrl: followerAvatarUrl,
          scheduledFor: pr.scheduledFor
        };
      })
    );
    
    // Get the circle for additional context
    const circle = await storage.getCircle(post.circleId);
    
    // Combine all data and send response
    res.json({
      ...post,
      interactions: interactionsWithUsers,
      threads: threads,
      pendingResponses: formattedPendingResponses.length > 0 ? formattedPendingResponses : [],
      circle: circle || undefined
    });
  } catch (error) {
    console.error("Error getting post:", error);
    res.status(500).json({ message: "Failed to get post" });
  }
});

/**
 * POST /api/posts - Create a new post
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    console.log("[Post Route] Received request body:", JSON.stringify(req.body));
    // Check if the request body is a stringified JSON
    let content, circleId, labId, labExperiment, targetRole;
    
    if (typeof req.body === 'string') {
      try {
        // Try to parse it as JSON
        const parsedBody = JSON.parse(req.body);
        content = parsedBody.content;
        circleId = parsedBody.circleId;
        labId = parsedBody.labId;
        labExperiment = parsedBody.labExperiment;
        targetRole = parsedBody.targetRole;
      } catch (e) {
        console.error("[Post Route] Failed to parse request body as JSON:", e);
        return res.status(400).json({ message: "Invalid request format" });
      }
    } else {
      // Normal object extraction
      ({ content, circleId, labId, labExperiment, targetRole } = req.body);
    }

    // Validate input
    if (!content) {
      console.error("[Post Route] Missing required content field");
      return res.status(400).json({ message: "Content is required" });
    }
    
    // Validate targetRole if present
    if (targetRole && !["control", "treatment", "observation", "all"].includes(targetRole)) {
      console.error(`[Post Route] Invalid targetRole value: ${targetRole}`);
      return res.status(400).json({ message: "Invalid targetRole value. Must be 'control', 'treatment', 'observation', or 'all'" });
    }
    
    // Check if this is a lab experiment post
    if (labExperiment && labId) {
      // If it's a lab experiment, we need to determine the circle based on the lab and targetRole
      // For now, we'll require a circleId to be provided as well, but in the future we could
      // automatically distribute to all lab circles with the specified role
      if (!circleId) {
        console.error("[Post Route] Missing required circle ID for lab experiment");
        return res.status(400).json({ message: "Circle ID is required even for lab experiments" });
      }
      
      // For lab experiments, targetRole is required
      if (!targetRole) {
        console.error("[Post Route] Missing required targetRole for lab experiment");
        return res.status(400).json({ message: "Target role is required for lab experiments" });
      }
      
      // Verify the lab exists and user has access
      const lab = await storage.getLab(labId);
      if (!lab || lab.userId !== req.user!.id) {
        return res.status(404).json({ message: "Lab not found or you don't have permission" });
      }
      
      // In the future, we could automatically distribute to multiple circles based on targetRole
      // But for now, we'll just use the provided circleId
    } else if (!circleId) {
      // If not a lab experiment, circleId is definitely required
      console.error("[Post Route] Missing required circle ID");
      return res.status(400).json({ message: "Circle ID is required" });
    }

    // Check if user has access to this circle
    const hasPermission = await hasCirclePermission(
      circleId, 
      req.user!.id, 
      storage,
      "collaborator"
    );
    
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Create the post using the createPostInCircle method
    const post = await storage.createPostInCircle(
      req.user!.id,
      circleId,
      content,
      labId,
      labExperiment,
      targetRole
    );
    
    // If this is a lab experiment post, create notifications for appropriate circles
    if (labExperiment && labId && targetRole) {
      try {
        console.log(`[Post Route] Creating lab experiment notifications for post ${post.id}`);
        await storage.createLabExperimentNotification(labId, post.id, targetRole as "control" | "treatment" | "observation" | "all");
      } catch (notificationError) {
        // Just log the error, don't stop execution
        console.error("[Post Route] Error creating lab experiment notifications:", notificationError);
      }
    }

    // Return early with the post while AI response processing happens in background
    res.status(201).json(post);

    // Get circle followers and schedule responses
    try {
      const circle = await storage.getCircle(circleId);
      if (!circle) return;

      // getCircleFollowers already includes mute status in the returned objects
      console.log("[Post Route] Getting circle followers for response scheduling");
      const followers = await storage.getCircleFollowers(circleId);
      
      // Schedule follower responses
      for (const follower of followers) {
        // Skip muted followers
        if (follower.muted) {
          console.log(`[Post Route] Skipping muted follower ${follower.id} (${follower.name})`);
          continue;
        }

        // Schedule response
        console.log(`[Post Route] Scheduling response from follower ${follower.id} (${follower.name})`);
        const scheduler = ResponseScheduler.getInstance();
        await scheduler.scheduleResponse(post.id, follower);
      }
    } catch (backgroundError) {
      // This is after we've sent the response, so just log the error
      console.error("[Post Route] Error in background response scheduling:", backgroundError);
      // Don't throw or call res.status() here as we've already sent a response
    }
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ message: "Failed to create post" });
  }
});

/**
 * GET /api/circles/:id/posts - Get posts for a circle
 */
router.get('/circle/:circleId', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.circleId);
  
  try {
    // Check if user has access to this circle
    const hasPermission = await hasCirclePermission(circleId, req.user!.id, storage);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    const posts = await storage.getCirclePosts(circleId);
    
    // Get interactions for each post
    const postsWithInteractions = await Promise.all(
      posts.map(async (post) => {
        const interactions = await storage.getPostInteractions(post.id);
        
        // Get user info for each interaction
        const interactionsWithUsers = await Promise.all(
          interactions.map(async (interaction) => {
            if (interaction.userType === "ai") {
              const follower = await storage.getAiFollower(interaction.authorId);
              return {
                ...interaction,
                author: follower,
                aiFollower: follower // Add aiFollower property for Comment component compatibility
              };
            } else {
              const user = await storage.getUser(interaction.authorId);
              return {
                ...interaction,
                author: user
              };
            }
          })
        );
        
        // Get thread structure using static ThreadManager method
        const threads = await ThreadManager.getThreadedInteractions(post.id);
        
        // Get top-level pending responses for the post
        const pendingResponses = await storage.getPostPendingResponses(post.id);
        
        // Format pending responses for frontend display
        const formattedPendingResponses = await Promise.all(
          pendingResponses.map(async (pr) => {
            let followerName = "AI";
            let followerAvatarUrl = "";
            
            if (pr.aiFollowerId) {
              const follower = await storage.getAiFollower(pr.aiFollowerId);
              if (follower) {
                followerName = follower.name;
                followerAvatarUrl = follower.avatarUrl;
              }
            }
            
            return {
              id: pr.id,
              name: followerName,
              avatarUrl: followerAvatarUrl,
              scheduledFor: pr.scheduledFor
            };
          })
        );
        
        return {
          ...post,
          interactions: interactionsWithUsers,
          threads: threads,
          pendingResponses: formattedPendingResponses.length > 0 ? formattedPendingResponses : []
        };
      })
    );
    
    res.json(postsWithInteractions);
  } catch (error) {
    console.error("Error getting posts:", error);
    res.status(500).json({ message: "Failed to get posts" });
  }
});

/**
 * GET /api/posts/:userId - Get posts for a user
 */
router.get('/user/:userId', requireAuth, async (req, res) => {
  const userIdStr = req.params.userId;
  const includeInteractions = req.query.includeInteractions === 'true';
  
  let userId: number;
  
  // Handle "me" as a special case
  if (userIdStr === "me") {
    userId = req.user!.id;
  } else {
    userId = parseInt(userIdStr);
    
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
  }
  
  try {
    // Get user's circles and circles the user is a member of
    const userCircles = await storage.getUserCircles(userId);
    const circleIds = [
      ...userCircles.owned.map(c => c.id),
      ...userCircles.shared.map(c => c.id)
    ];
    
    // Get posts from these circles
    const allPosts = [];
    
    for (const circleId of circleIds) {
      const hasAccess = await hasCirclePermission(circleId, req.user!.id, storage);
      if (!hasAccess) continue;
      
      const circlePosts = await storage.getCirclePosts(circleId);
      allPosts.push(...circlePosts);
    }
    
    // Sort by created date, most recent first
    allPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Optionally include interactions
    if (includeInteractions) {
      const postsWithInteractions = await Promise.all(
        allPosts.map(async (post) => {
          const interactions = await storage.getPostInteractions(post.id);
          
          // Get user info for each interaction
          const interactionsWithUsers = await Promise.all(
            interactions.map(async (interaction) => {
              if (interaction.userType === "ai") {
                const follower = await storage.getAiFollower(interaction.authorId);
                return {
                  ...interaction,
                  author: follower,
                  aiFollower: follower // Add aiFollower property for Comment component compatibility
                };
              } else {
                const user = await storage.getUser(interaction.authorId);
                return {
                  ...interaction,
                  author: user
                };
              }
            })
          );
          
          // Get thread structure using static ThreadManager method
          const threads = await ThreadManager.getThreadedInteractions(post.id);
          
          // Get top-level pending responses for the post
          const pendingResponses = await storage.getPostPendingResponses(post.id);
          
          // Format pending responses for frontend display
          const formattedPendingResponses = await Promise.all(
            pendingResponses.map(async (pr) => {
              let followerName = "AI";
              let followerAvatarUrl = "";
              
              if (pr.aiFollowerId) {
                const follower = await storage.getAiFollower(pr.aiFollowerId);
                if (follower) {
                  followerName = follower.name;
                  followerAvatarUrl = follower.avatarUrl;
                }
              }
              
              return {
                id: pr.id,
                name: followerName,
                avatarUrl: followerAvatarUrl,
                scheduledFor: pr.scheduledFor
              };
            })
          );
          
          return {
            ...post,
            interactions: interactionsWithUsers,
            threads: threads,
            pendingResponses: formattedPendingResponses.length > 0 ? formattedPendingResponses : []
          };
        })
      );
      
      res.json(postsWithInteractions);
    } else {
      res.json(allPosts);
    }
  } catch (error) {
    console.error("Error getting user posts:", error);
    res.status(500).json({ message: "Failed to get user posts" });
  }
});

/**
 * PATCH /api/posts/:id/move - Move post to a different circle
 */
router.patch('/:id/move', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  const { targetCircleId } = req.body;
  
  try {
    // Verify post ownership
    const post = await storage.getPost(postId);
    if (!post || post.userId !== req.user!.id) {
      return res.status(404).json({ message: "Post not found or you don't have permission" });
    }
    
    // Check if user has access to target circle
    const hasPermission = await hasCirclePermission(
      targetCircleId, 
      req.user!.id, 
      storage,
      "collaborator"
    );
    
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied to target circle" });
    }
    
    // Move post
    const updatedPost = await storage.movePostToCircle(postId, targetCircleId);
    res.json(updatedPost);
  } catch (error) {
    console.error("Error moving post:", error);
    res.status(500).json({ message: "Failed to move post" });
  }
});

/**
 * POST /api/posts/:postId/reply - Reply to a post
 */
router.post('/:postId/reply', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId);
  const { content, parentInteractionId } = req.body;
  
  try {
    // Get the post
    const post = await storage.getPost(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    
    // Check if user has access to the circle
    const hasPermission = await hasCirclePermission(post.circleId, req.user!.id, storage);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    // Create the interaction
    const interaction = await storage.createAiInteraction({
      postId,
      userId: req.user!.id,
      aiFollowerId: null,
      content,
      type: "comment",
      parentId: parentInteractionId || null
    });
    
    // Get user info
    const user = await storage.getUser(req.user!.id);
    
    // Return the interaction with user info
    const interactionWithUser = {
      ...interaction,
      author: user
    };
    
    res.status(201).json(interactionWithUser);
    
    // If this is a direct reply to an AI follower, schedule a response
    if (parentInteractionId) {
      const parentInteraction = await storage.getInteraction(parentInteractionId);
      
      if (parentInteraction && parentInteraction.aiFollowerId) {
        // Get the AI follower
        const follower = await storage.getAiFollower(parentInteraction.aiFollowerId);
        
        if (follower) {
          // Check if follower is muted in this circle
          const relationship = await storage.getCircleFollowerRelationship(post.circleId, follower.id);
          if (relationship && relationship.muted) return;
          
          // Get thread context
          const contextMetadata = await contextManager.buildThreadContext(
            interaction,
            parentInteraction,
            follower
          );
          
          // Schedule thread response
          const scheduler = ResponseScheduler.getInstance();
          await scheduler.scheduleThreadResponse(
            postId, 
            follower, 
            parentInteractionId,
            JSON.stringify(contextMetadata),
            true // This user is the primary target
          );
          
          // Also notify other participants in the thread
          if (parentInteraction.parentId) {
            const threadRoot = await storage.getInteraction(parentInteraction.parentId);
            if (threadRoot && threadRoot.aiFollowerId && threadRoot.aiFollowerId !== follower.id) {
              const threadRootFollower = await storage.getAiFollower(threadRoot.aiFollowerId);
              
              if (threadRootFollower) {
                // Check if follower is muted
                const rootFollowerRelationship = await storage.getCircleFollowerRelationship(
                  post.circleId, 
                  threadRootFollower.id
                );
                
                if (!rootFollowerRelationship || !rootFollowerRelationship.muted) {
                  // Schedule response from the root follower too
                  await scheduler.scheduleThreadResponse(
                    postId, 
                    threadRootFollower, 
                    parentInteractionId,
                    JSON.stringify(contextMetadata),
                    false // This follower is not the primary target
                  );
                }
              }
            }
          }
        }
      }
    } else {
      try {
        // This is a top-level comment, notify all AI followers in the circle
        console.log("[Post Route] Getting circle followers for top-level comment response scheduling");
        const followers = await storage.getCircleFollowers(post.circleId);
        
        // Schedule follower responses
        const scheduler = ResponseScheduler.getInstance();
        
        for (const follower of followers) {
          // Skip muted followers
          if (follower.muted) {
            console.log(`[Post Route] Skipping muted follower ${follower.id} (${follower.name})`);
            continue;
          }
          
          // Schedule response
          console.log(`[Post Route] Scheduling response from follower ${follower.id} (${follower.name})`);
          await scheduler.scheduleResponse(postId, follower);
        }
      } catch (backgroundError) {
        // This is after we've sent the response, so just log the error
        console.error("[Post Route] Error in background response scheduling:", backgroundError);
      }
    }
  } catch (error) {
    console.error("Error creating reply:", error);
    res.status(500).json({ message: "Failed to create reply" });
  }
});

export default router;