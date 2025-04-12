import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth, hasCirclePermission } from './middleware';
import { ThreadManager } from '../thread-manager';

const router = Router();

/**
 * GET /api/circles/:id - Get circle by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  // Handle 'default' as a special case
  if (req.params.id === 'default') {
    try {
      const defaultCircle = await storage.getDefaultCircle(req.user!.id);
      res.json(defaultCircle);
    } catch (error) {
      console.error("Error getting default circle:", error);
      res.status(500).json({ message: "Failed to get default circle" });
    }
    return;
  }

  const circleId = parseInt(req.params.id);
  if (isNaN(circleId)) {
    return res.status(400).json({ message: "Invalid circle ID" });
  }

  try {
    // Check if user has access to this circle
    const hasPermission = await hasCirclePermission(circleId, req.user!.id, storage);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    const circle = await storage.getCircle(circleId);
    if (!circle) {
      return res.status(404).json({ message: "Circle not found" });
    }
    res.json(circle);
  } catch (error) {
    console.error("Error getting circle:", error);
    res.status(500).json({ message: "Failed to get circle" });
  }
});

/**
 * GET /api/circles - Get user circles categorized
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const circles = await storage.getUserCircles(req.user!.id);
    const deactivatedCircles = await storage.getDeactivatedCircles(req.user!.id);

    // Check the format requested by the client
    const format = req.query.format || 'categorized';

    if (format === 'array') {
      // For test compatibility, return a simple array of all circles
      const allCircles = [
        ...circles.owned,
        ...circles.shared,
        ...circles.invited
      ];
      res.json(allCircles);
    } else {
      // Default to categorized view for the frontend
      const categorizedCircles = {
        private: circles.owned.filter(c => c.visibility !== "shared"),
        shared: circles.owned.filter(c => c.visibility === "shared"),
        sharedWithYou: circles.shared,
        invited: circles.invited,
        deactivated: deactivatedCircles
      };
      res.json(categorizedCircles);
    }
  } catch (error) {
    console.error("Error getting circles:", error);
    res.status(500).json({ message: "Failed to get circles" });
  }
});

/**
 * GET /api/circles/deactivated - Get deactivated circles
 */
router.get('/deactivated', requireAuth, async (req, res) => {
  try {
    const deactivatedCircles = await storage.getDeactivatedCircles(req.user!.id);
    res.json(deactivatedCircles);
  } catch (error) {
    console.error("Error getting deactivated circles:", error);
    res.status(500).json({ message: "Failed to get deactivated circles" });
  }
});

/**
 * GET /api/circles/invitations/pending - Get pending invitations with circle info
 */
router.get('/invitations/pending', requireAuth, async (req, res) => {
  try {
    const invitations = await storage.getUserPendingInvitations(req.user!.id);

    // Get circle information for each invitation
    const invitationsWithCircles = await Promise.all(
      invitations.map(async (invitation) => {
        const circle = await storage.getCircle(invitation.circleId);
        return {
          ...invitation,
          circle
        };
      })
    );

    res.json(invitationsWithCircles);
  } catch (error) {
    console.error("Error getting pending invitations:", error);
    res.status(500).json({ message: "Failed to get pending invitations" });
  }
});

/**
 * POST /api/circles/:id/invitations - Create invitation
 */
router.post('/:id/invitations', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  const { username, role } = req.body;

  try {
    // Verify circle ownership and existence
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found" });
    }

    // Get invitee user by username
    const invitee = await storage.getUserByUsername(username);
    if (!invitee) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user is already a member
    const members = await storage.getCircleMembers(circleId);
    if (members.some(member => member.userId === invitee.id)) {
      return res.status(400).json({ message: "User is already a member of this circle" });
    }

    // Check for existing pending invitation
    const invitations = await storage.getCircleInvitations(circleId);
    if (invitations.some(inv => inv.inviteeId === invitee.id && inv.status === "pending")) {
      return res.status(400).json({ message: "User already has a pending invitation" });
    }

    // Create invitation
    const invitation = await storage.createCircleInvitation({
      circleId,
      inviteeId: invitee.id,
      role
    });

    // Update circle visibility to shared
    if (circle.visibility === "private") {
      await storage.updateCircle(circleId, { visibility: "shared" });
    }

    res.status(201).json(invitation);
  } catch (error) {
    console.error("Error creating invitation:", error);
    res.status(500).json({ message: "Failed to create invitation" });
  }
});

/**
 * PATCH /api/circles/invitations/:id - Respond to invitation
 */
router.patch('/invitations/:id', requireAuth, async (req, res) => {
  const invitationId = parseInt(req.params.id);
  const { status } = req.body;

  try {
    const invitation = await storage.getCircleInvitation(invitationId);
    if (!invitation || invitation.inviteeId !== req.user!.id) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    if (invitation.status !== "pending") {
      return res.status(400).json({ message: "Invitation has already been responded to" });
    }

    const updatedInvitation = await storage.updateInvitationStatus(invitationId, status);
    console.log(`[Invitations] Invitation ${invitationId} updated to status: ${status}`);
    res.json(updatedInvitation);
  } catch (error) {
    console.error("Error responding to invitation:", error);
    res.status(500).json({ message: "Failed to respond to invitation" });
  }
});

/**
 * GET /api/default-circle - Get user's default circle
 */
router.get('/default-circle', requireAuth, async (req, res) => {
  try {
    const defaultCircle = await storage.getDefaultCircle(req.user!.id);
    res.json(defaultCircle);
  } catch (error) {
    console.error("Error getting default circle:", error);
    res.status(500).json({ message: "Failed to get default circle" });
  }
});

/**
 * POST /api/circles - Create a new circle
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const circle = await storage.createCircle(req.user!.id, req.body);
    res.status(201).json(circle);
  } catch (error) {
    console.error("Error creating circle:", error);
    res.status(500).json({ message: "Failed to create circle" });
  }
});

/**
 * PATCH /api/circles/:id - Update circle
 */
router.patch('/:id', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  try {
    // Verify circle ownership
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found" });
    }

    const updatedCircle = await storage.updateCircle(circleId, req.body);
    res.json(updatedCircle);
  } catch (error) {
    console.error("Error updating circle:", error);
    res.status(500).json({ message: "Failed to update circle" });
  }
});

/**
 * POST /api/circles/:id/set-default - Set circle as default
 */
router.post('/:id/set-default', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  try {
    // Verify circle ownership
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found" });
    }

    const updatedCircle = await storage.setDefaultCircle(req.user!.id, circleId);
    res.json(updatedCircle);
  } catch (error) {
    console.error("Error setting default circle:", error);
    res.status(500).json({ message: "Failed to set default circle" });
  }
});

/**
 * DELETE /api/circles/:id - Delete circle
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  try {
    // Verify circle ownership
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found" });
    }

    if (circle.isDefault) {
      return res.status(400).json({ message: "Cannot delete default circle" });
    }

    await storage.deleteCircle(circleId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting circle:", error);
    res.status(500).json({ message: "Failed to delete circle" });
  }
});

/**
 * GET /api/circles/:id/details - Get detailed circle info
 */
router.get('/:id/details', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  try {
    // Check if user has access to this circle
    const hasPermission = await hasCirclePermission(circleId, req.user!.id, storage);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Use the getCircleWithDetails method which already handles members with usernames
    const details = await storage.getCircleWithDetails(circleId);
    if (!details) {
      return res.status(404).json({ message: "Circle not found" });
    }

    // The getCircleWithDetails already returns the correct structure
    res.json(details);
  } catch (error) {
    console.error("Error getting circle details:", error);
    res.status(500).json({ message: "Failed to get circle details" });
  }
});

/**
 * POST /api/circles/:id/members/:userId/deactivate - Deactivate circle member
 */
router.post('/:id/members/:userId/deactivate', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);

  try {
    // Verify circle ownership
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found or you don't have permission" });
    }

    // Make sure user isn't trying to deactivate themselves (the owner)
    if (targetUserId === req.user!.id) {
      return res.status(400).json({ message: "Circle owner cannot be deactivated" });
    }

    await storage.deactivateCircleMember(circleId, targetUserId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deactivating circle member:", error);
    res.status(500).json({ message: "Failed to deactivate circle member" });
  }
});

/**
 * POST /api/circles/:id/members/:userId/reactivate - Reactivate circle member
 */
router.post('/:id/members/:userId/reactivate', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);

  try {
    // Verify circle ownership
    const circle = await storage.getCircle(circleId);
    if (!circle || circle.userId !== req.user!.id) {
      return res.status(404).json({ message: "Circle not found or you don't have permission" });
    }

    await storage.reactivateCircleMember(circleId, targetUserId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error reactivating circle member:", error);
    res.status(500).json({ message: "Failed to reactivate circle member" });
  }
});

/**
 * GET /api/circles/:id/posts - Get posts for a circle
 * This is a compatibility route that forwards requests to the posts module
 */
router.get('/:id/posts', requireAuth, async (req, res) => {
  const circleId = parseInt(req.params.id);
  
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
            if (interaction.aiFollowerId) {
              const follower = await storage.getAiFollower(interaction.aiFollowerId);
              return {
                ...interaction,
                author: follower,
                userType: "ai", // Add this for frontend compatibility
                authorId: interaction.aiFollowerId // Add this for frontend compatibility
              };
            } else if (interaction.userId) {
              const user = await storage.getUser(interaction.userId);
              return {
                ...interaction,
                author: user,
                userType: "human", // Add this for frontend compatibility
                authorId: interaction.userId // Add this for frontend compatibility
              };
            } else {
              // Fallback case
              return {
                ...interaction,
                author: null,
                userType: "unknown",
                authorId: null
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

export default router;