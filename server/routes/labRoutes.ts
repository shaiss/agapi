import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth, hasCirclePermission } from './middleware';
import { insertLabSchema, insertLabCircleSchema } from '@shared/schema';

const router = Router();

/**
 * GET /api/labs - Get all labs
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    // Use the authenticated user's ID to get their labs
    const userId = req.user!.id;
    const labs = await storage.getUserLabs(userId);
    res.json(labs);
  } catch (error) {
    console.error("Error getting labs:", error);
    res.status(500).json({ message: "Failed to get labs" });
  }
});

/**
 * GET /api/labs/:id - Get lab by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }
    
    res.json(lab);
  } catch (error) {
    console.error("Error getting lab:", error);
    res.status(500).json({ message: "Failed to get lab" });
  }
});

/**
 * POST /api/labs - Create a new lab
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    // Parse and validate lab data
    const parsedData = insertLabSchema.safeParse(req.body);
    
    if (!parsedData.success) {
      return res.status(400).json({ 
        message: "Invalid lab data", 
        errors: parsedData.error.errors 
      });
    }
    
    // Create lab
    const lab = await storage.createLab(req.user!.id, {
      ...parsedData.data,
      status: "draft"
    });
    
    res.status(201).json(lab);
  } catch (error) {
    console.error("Error creating lab:", error);
    res.status(500).json({ message: "Failed to create lab" });
  }
});

/**
 * POST /api/labs/circles - Create a new lab with circle
 */
router.post('/circles', requireAuth, async (req, res) => {
  try {
    // Create lab and circle in one transaction
    const { lab: labData, circle: circleData } = req.body;
    
    // Parse and validate lab data
    const parsedLabData = insertLabSchema.safeParse(labData);
    
    if (!parsedLabData.success) {
      return res.status(400).json({ 
        message: "Invalid lab data", 
        errors: parsedLabData.error.errors 
      });
    }
    
    // Create lab
    const lab = await storage.createLab(req.user!.id, {
      ...parsedLabData.data,
      status: "draft"
    });
    
    // Create circle for the lab
    const circle = await storage.createCircle(req.user!.id, circleData);
    
    // Associate circle with lab
    await storage.addCircleToLab(lab.id, circle.id, "control");
    
    res.status(201).json({
      lab,
      circle
    });
  } catch (error) {
    console.error("Error creating lab with circle:", error);
    res.status(500).json({ message: "Failed to create lab with circle" });
  }
});

/**
 * PATCH /api/labs/:id - Update lab
 */
router.patch('/:id', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Update lab
    const updatedLab = await storage.updateLab(labId, req.body);
    res.json(updatedLab);
  } catch (error) {
    console.error("Error updating lab:", error);
    res.status(500).json({ message: "Failed to update lab" });
  }
});

/**
 * DELETE /api/labs/:id - Delete lab
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Delete lab
    await storage.deleteLab(labId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting lab:", error);
    res.status(500).json({ message: "Failed to delete lab" });
  }
});

/**
 * POST /api/labs/:id/duplicate - Duplicate lab
 */
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    // Verify lab exists
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }
    
    // Duplicate lab
    const duplicatedLab = await storage.duplicateLab(labId, req.user!.id);
    res.status(201).json(duplicatedLab);
  } catch (error) {
    console.error("Error duplicating lab:", error);
    res.status(500).json({ message: "Failed to duplicate lab" });
  }
});

/**
 * PATCH /api/labs/:id/status - Update lab status
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  const { status } = req.body;
  
  try {
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Validate status
    const validStatuses = ["draft", "active", "completed", "archived"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    
    // Update lab status
    const updatedLab = await storage.updateLab(labId, { status });
    res.json(updatedLab);
  } catch (error) {
    console.error("Error updating lab status:", error);
    res.status(500).json({ message: "Failed to update lab status" });
  }
});

/**
 * GET /api/labs/:id/circles - Get lab circles
 */
router.get('/:id/circles', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    // Verify lab exists
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }
    
    // Get lab circles
    const labCircles = await storage.getLabCircles(labId);
    
    // Get full circle data
    const circles = await Promise.all(
      labCircles.map(async (lc) => {
        const circle = await storage.getCircle(lc.circleId);
        return {
          ...lc,
          circle
        };
      })
    );
    
    res.json(circles);
  } catch (error) {
    console.error("Error getting lab circles:", error);
    res.status(500).json({ message: "Failed to get lab circles" });
  }
});

/**
 * GET /api/labs/:id/circles/stats - Get lab circle stats
 */
router.get('/:id/circles/stats', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  
  try {
    // Verify lab exists
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }
    
    // Get lab circles
    const labCircles = await storage.getLabCircles(labId);
    
    // Get stats for each circle
    const stats = await Promise.all(
      labCircles.map(async (lc) => {
        // Make sure we have a valid circleId
        if (!lc.circleId) {
          console.error("Invalid circleId found in lab circle:", lc);
          return {
            labCircle: {
              id: lc.id || 0,
              role: lc.role || "observation",
              circleId: 0,
              addedAt: lc.addedAt || new Date()
            },
            circle: null,
            stats: {
              postCount: 0,
              followerCount: 0,
              memberCount: 0
            }
          };
        }
        
        // Keep the circle data separate in the response to maintain the expected structure
        const circle = await storage.getCircle(lc.circleId);
        const postCount = await storage.getCirclePostCount(lc.circleId);
        const followerCount = await storage.getCircleFollowerCount(lc.circleId);
        const memberCount = await storage.getCircleMemberCount(lc.circleId);
        
        return {
          labCircle: {
            id: lc.id,
            role: lc.role,
            circleId: lc.circleId,
            addedAt: lc.addedAt || new Date()
          },
          circle, // This keeps the circle object separate from the labCircle
          stats: {
            postCount,
            followerCount,
            memberCount
          }
        };
      })
    );
    
    res.json(stats);
  } catch (error) {
    console.error("Error getting lab circle stats:", error);
    res.status(500).json({ message: "Failed to get lab circle stats" });
  }
});

/**
 * GET /api/labs/:id/posts - Get posts from all lab circles
 */
router.get('/:id/posts', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  const targetRole = req.query.role as string | undefined;
  
  try {
    // Verify lab exists
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }
    
    // Get lab circles
    let labCircles = await storage.getLabCircles(labId);
    
    // Filter by role if specified
    if (targetRole && ["control", "treatment", "observation"].includes(targetRole)) {
      labCircles = labCircles.filter(lc => lc.role === targetRole);
    }
    
    // Get posts from all circles
    const allPosts = [];
    
    for (const lc of labCircles) {
      // Check if user has access to this circle
      const hasAccess = await hasCirclePermission(lc.circleId, req.user!.id, storage);
      if (!hasAccess) continue;
      
      const circlePosts = await storage.getCirclePosts(lc.circleId);
      
      // Add circle info to each post
      const circle = await storage.getCircle(lc.circleId);
      
      // Process each post to include necessary data
      for (const post of circlePosts) {
        // Get post interactions
        const interactions = await storage.getPostInteractions(post.id);
        
        // Get pending AI responses if any
        const pendingResponses = await storage.getPendingResponses(post.id);
        
        // Create enhanced post object
        const enhancedPost = {
          ...post,
          circle: {
            ...circle,
            role: lc.role // Include the role in the circle object
          },
          interactions: interactions || [],
          pendingResponses: pendingResponses || []
        };
        
        allPosts.push(enhancedPost);
      }
    }
    
    // Sort by created date, most recent first
    allPosts.sort((a, b) => {
      // Handle potential null dates gracefully
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    
    // Apply filter by targetRole if present in the post data
    let filteredPosts = allPosts;
    if (targetRole && targetRole !== "all") {
      filteredPosts = allPosts.filter(post => 
        post.targetRole === targetRole || !post.targetRole);
    }
    
    res.json(filteredPosts);
  } catch (error) {
    console.error("Error getting lab posts:", error);
    res.status(500).json({ message: "Failed to get lab posts" });
  }
});

/**
 * POST /api/labs/:id/circles - Add circle to lab
 */
router.post('/:id/circles', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  const { circleId, role } = req.body;
  
  try {
    // Verify parameters
    if (isNaN(labId) || isNaN(circleId)) {
      return res.status(400).json({ message: "Invalid lab ID or circle ID" });
    }
    
    if (!role || !["control", "treatment", "observation"].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'control', 'treatment', or 'observation'" });
    }
    
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Verify circle ownership or access
    const hasPermission = await hasCirclePermission(
      circleId, 
      req.user!.id, 
      storage,
      "collaborator"
    );
    
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied to circle" });
    }
    
    // Check if circle is already in the lab
    const labCircles = await storage.getLabCircles(labId);
    if (labCircles.some(lc => lc.circleId === circleId)) {
      return res.status(400).json({ message: "Circle is already in this lab" });
    }
    
    // Add circle to lab with the specified role
    const labCircle = await storage.addCircleToLab(labId, circleId, role);
    
    // Get circle data
    const circle = await storage.getCircle(circleId);
    
    res.status(201).json({
      ...labCircle,
      circle
    });
  } catch (error) {
    console.error("Error adding circle to lab:", error);
    res.status(500).json({ message: "Failed to add circle to lab" });
  }
});

/**
 * DELETE /api/labs/:labId/circles/:circleId - Remove circle from lab
 */
router.delete('/:labId/circles/:circleId', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.labId);
  const circleId = parseInt(req.params.circleId);
  
  try {
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Remove circle from lab
    await storage.removeCircleFromLab(labId, circleId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error removing circle from lab:", error);
    res.status(500).json({ message: "Failed to remove circle from lab" });
  }
});

/**
 * PATCH /api/labs/:labId/circles/:circleId - Update lab circle
 */
router.patch('/:labId/circles/:circleId', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.labId);
  const circleId = parseInt(req.params.circleId);
  const { role } = req.body;
  
  try {
    // Verify parameters
    if (isNaN(labId) || isNaN(circleId)) {
      return res.status(400).json({ message: "Invalid lab ID or circle ID" });
    }
    
    if (!role || !["control", "treatment", "observation"].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'control', 'treatment', or 'observation'" });
    }
    
    // Verify lab ownership
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }
    
    // Update lab circle
    const updatedLabCircle = await storage.updateLabCircleRole(labId, circleId, role);
    
    // Get circle data
    const circle = await storage.getCircle(circleId);
    
    res.json({
      ...updatedLabCircle,
      circle
    });
  } catch (error) {
    console.error("Error updating lab circle:", error);
    res.status(500).json({ message: "Failed to update lab circle" });
  }
});

export default router;