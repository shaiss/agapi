import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth, hasCirclePermission } from './middleware';
import { insertLabSchema, insertLabCircleSchema, insertLabContentSchema } from '@shared/schema';

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
    
    // Set launchedAt timestamp when status changes to active
    const updateData: any = { status };
    if (status === 'active') {
      updateData.launchedAt = new Date();
    }
    
    // Update lab status
    const updatedLab = await storage.updateLab(labId, updateData);
    
    // Return immediately to avoid blocking the UI
    res.json(updatedLab);
    
    // If activating the lab, publish lab content in the background
    if (status === 'active') {
      // Run content publishing asynchronously
      setImmediate(async () => {
        try {
          console.log(`[Lab Activation] Starting background content publishing for lab ${labId}`);
          
          // Import WebSocket broadcast function
          const { broadcastWebSocketMessage } = await import('../websocket');
          
          // Notify user that content publishing is starting
          broadcastWebSocketMessage({
            type: 'lab_activation_started',
            labId,
            message: 'Publishing lab content to circles...'
          }, [req.user!.id]);
          
          await storage.publishLabContent(labId);
          
          // Notify user that content publishing completed successfully
          broadcastWebSocketMessage({
            type: 'lab_activation_completed',
            labId,
            success: true,
            message: 'Lab content successfully published to circles with AI responses scheduled'
          }, [req.user!.id]);
          
          console.log(`[Lab Activation] Successfully published content for lab ${labId}`);
        } catch (contentError) {
          console.error(`[Lab Activation] Failed to publish content for lab ${labId}:`, contentError);
          
          // Import WebSocket broadcast function for error notification
          const { broadcastWebSocketMessage: broadcastError } = await import('../websocket');
          
          // Notify user of the error
          broadcastError({
            type: 'lab_activation_completed',
            labId,
            success: false,
            error: 'Failed to publish some lab content. Please check the lab status.',
            message: 'Lab activation encountered an issue'
          }, [req.user!.id]);
        }
      });
    }
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
    
    // Get circles from lab content variants instead of lab_circles table
    const labContent = await storage.getLabContent(labId);
    
    // Extract unique circles from content variants
    const circleIds = [...new Set(labContent.map(content => content.circleId).filter(Boolean))];
    
    // Get full circle data with content info
    const circles = await Promise.all(
      circleIds.map(async (circleId) => {
        const circle = await storage.getCircle(circleId);
        const contentForCircle = labContent.filter(content => content.circleId === circleId);
        
        return {
          id: circleId,
          circleId: circleId,
          role: "treatment", // Default role since we're using direct assignment now
          addedAt: contentForCircle[0]?.createdAt || new Date(),
          circle: circle,
          contentCount: contentForCircle.length
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
    
    // Get circles from lab content variants instead of lab_circles table
    const labContent = await storage.getLabContent(labId);
    
    // Extract unique circles from content variants
    const circleIds = [...new Set(labContent.map(content => content.circleId).filter(Boolean))];
    
    // Get stats for each circle
    const stats = await Promise.all(
      circleIds.map(async (circleId) => {
        const circle = await storage.getCircle(circleId);
        const contentForCircle = labContent.filter(content => content.circleId === circleId);
        const postCount = await storage.getCirclePostCount(circleId);
        const followerCount = await storage.getCircleFollowerCount(circleId);
        const memberCount = await storage.getCircleMemberCount(circleId);
        
        return {
          labCircle: {
            id: circleId,
            role: "treatment", // Default role since we're using direct assignment now
            circleId: circleId,
            addedAt: contentForCircle[0]?.createdAt || new Date()
          },
          circle,
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

    // Get posts explicitly associated with the lab
    let labPosts = await storage.getLabPosts(labId);

    // Filter posts by role if specified
    if (targetRole && ["control", "treatment", "observation"].includes(targetRole)) {
      labPosts = labPosts.filter((post: any) => post.circle && post.circle.role === targetRole);
    }

    // Sort by created date, most recent first
    labPosts.sort((a: any, b: any) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json(labPosts);
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

/**
 * GET /api/labs/:id/pending-responses - Get pending responses for lab posts
 */
router.get('/:id/pending-responses', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);

  try {
    // Verify lab exists
    const lab = await storage.getLab(labId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }

    // Get pending response statistics for this lab
    const pendingStats = await storage.getLabPendingResponses(labId);
    
    res.json(pendingStats);
  } catch (error) {
    console.error("Error getting lab pending responses:", error);
    res.status(500).json({ message: "Failed to get lab pending responses" });
  }
});

/**
 * GET /api/labs/:id/content - Get lab content
 */
router.get('/:id/content', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);

  try {
    // Verify lab exists and user owns it
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }

    const content = await storage.getLabContent(labId);
    res.json(content);
  } catch (error) {
    console.error("Error getting lab content:", error);
    res.status(500).json({ message: "Failed to get lab content" });
  }
});

/**
 * POST /api/labs/:id/content - Create lab content
 */
router.post('/:id/content', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);

  try {
    // Verify lab exists and user owns it
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }

    // Parse and validate content data
    const parsedData = insertLabContentSchema.safeParse({ ...req.body, labId });
    
    if (!parsedData.success) {
      return res.status(400).json({ 
        message: "Invalid content data", 
        errors: parsedData.error.errors 
      });
    }

    const content = await storage.createLabContent(labId, parsedData.data);
    res.status(201).json(content);
  } catch (error) {
    console.error("Error creating lab content:", error);
    res.status(500).json({ message: "Failed to create lab content" });
  }
});

/**
 * PUT /api/labs/:id/content/:contentId - Update lab content
 */
router.put('/:id/content/:contentId', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  const contentId = parseInt(req.params.contentId);

  try {
    // Verify lab exists and user owns it
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }

    const content = await storage.updateLabContent(contentId, req.body);
    res.json(content);
  } catch (error) {
    console.error("Error updating lab content:", error);
    res.status(500).json({ message: "Failed to update lab content" });
  }
});

/**
 * DELETE /api/labs/:id/content/:contentId - Delete lab content
 */
router.delete('/:id/content/:contentId', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);
  const contentId = parseInt(req.params.contentId);

  try {
    // Verify lab exists and user owns it
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }

    await storage.deleteLabContent(contentId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting lab content:", error);
    res.status(500).json({ message: "Failed to delete lab content" });
  }
});

/**
 * POST /api/labs/:id/activate - Activate lab and publish content
 */
router.post('/:id/activate', requireAuth, async (req, res) => {
  const labId = parseInt(req.params.id);

  try {
    // Verify lab exists and user owns it
    const lab = await storage.getLab(labId);
    if (!lab || lab.userId !== req.user!.id) {
      return res.status(404).json({ message: "Lab not found or you don't have permission" });
    }

    // Update lab status to active
    const updatedLab = await storage.updateLab(labId, { 
      status: "active", 
      launchedAt: new Date() 
    });

    // Publish lab content as posts
    await storage.publishLabContent(labId);

    res.json(updatedLab);
  } catch (error) {
    console.error("Error activating lab:", error);
    res.status(500).json({ message: "Failed to activate lab" });
  }
});

export default router;