import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lab, Circle, Post } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { analyzeMetric, generateRecommendation as apiGenerateRecommendation, groupPostsByCircleRole } from "@/lib/metricsApi";

// Type definitions for metric results
export interface MetricResult {
  name: string;
  target: string | number;  // Allow both string and number types for target
  priority: "high" | "medium" | "low";
  actual: string;
  status: "success" | "warning" | "fail";
  confidence: number;
  difference: string;
  analysis?: string; // Optional detailed analysis from LLM
}

// Type for a lab circle with role information
export interface LabCircle extends Circle {
  role: "control" | "treatment" | "observation";
}

// Type for circle posts data
export interface CirclePosts {
  circleId: number;
  posts: Post[];
}

// Type for recommendation
export interface Recommendation {
  decision: "go" | "wait" | "rethink";
  confidence: number;
  reasoning: string;
}

// Import formatMetricValue from formatters utility
export { formatMetricValue } from "@/lib/formatters";

/**
 * Hook that analyzes lab metrics and generates results and recommendations
 */
export const useLabResultsAnalysis = (lab: Lab) => {
  const { toast } = useToast();
  const [metricResults, setMetricResults] = useState<MetricResult[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<Error | null>(null);

  // Fetch lab circles data
  const { 
    data: labCirclesData, 
    isLoading: isCirclesLoading,
    error: circlesError
  } = useQuery<any[]>({
    queryKey: [`/api/labs/${lab?.id}/circles`],
    enabled: !!lab?.id && (lab.status === "active" || lab.status === "completed")
  });
  
  // Transform the lab circles data to include role information
  const labCircles = labCirclesData?.map(item => {
    // The server returns data with the role at the top level and circle data in a nested object
    return {
      ...item.circle,
      role: item.role
    } as LabCircle;
  });

  // Fetch circle posts data for all circles in the lab
  const {
    data: circlePostsData,
    isLoading: isPostsLoading,
    error: postsError
  } = useQuery<any[]>({
    queryKey: [`/api/labs/${lab?.id}/posts`],
    enabled: !!lab?.id && (lab.status === "active" || lab.status === "completed") && !!labCircles && labCircles.length > 0
  });
  
  // Transform the posts data to the format expected by the analyzer
  const circlePosts = circlePostsData?.map(post => {
    // Return a simplified post object with just the required fields
    return {
      id: post.id,
      circleId: post.circleId,
      content: post.content,
      createdAt: post.createdAt,
      // Add any other needed fields
    } as Post;
  });

  // Main analysis function
  const analyzeLabMetrics = async () => {
    // Early return checks
    if (!lab?.successMetrics?.metrics || lab.successMetrics.metrics.length === 0) {
      console.log("No success metrics defined for this lab");
      setMetricResults([]);
      setRecommendation(null);
      return;
    }

    // Make sure we have the data we need
    if (!labCirclesData || !circlePostsData || labCirclesData.length === 0) {
      console.log("Missing or empty circle or post data for analysis");
      return;
    }

    // Set analyzing state
    setIsAnalyzing(true);
    setAnalyzeError(null);
    
    try {
      // Prepare the circle data from the API response
      const preparedCircles = labCirclesData.map(item => {
        return {
          id: item.circle?.id,
          name: item.circle?.name || 'Unknown Circle',
          role: item.role || 'observation',
          createdAt: item.circle?.createdAt
        } as LabCircle;
      });
      
      // Prepare the post data from the API response
      const preparedPosts = circlePostsData.map(post => {
        return {
          id: post.id,
          circleId: post.circleId,
          content: post.content || "",
          createdAt: post.createdAt
        } as Post;
      });

      console.log(`Analysis preparation complete: ${preparedCircles.length} circles, ${preparedPosts.length} posts`);
      
      // Group posts by circle role using our utility
      const { controlCircles, treatmentCircles, observationCircles } = 
        groupPostsByCircleRole(preparedCircles, preparedPosts);
      
      // Analyze each metric using the API
      const analyzedMetrics = [];
      
      for (const metric of lab.successMetrics.metrics) {
        try {
          // Prepare the request data
          const requestData = {
            metric: {
              name: metric.name,
              target: metric.target,
              priority: metric.priority
            },
            labGoals: lab.goals || '',
            controlCircles,
            treatmentCircles,
            observationCircles
          };
          
          // Call the API endpoint for analysis
          const result = await analyzeMetric(requestData);
          analyzedMetrics.push(result);
        } catch (error) {
          console.error(`Error analyzing metric ${metric.name}:`, error);
          
          // Add a placeholder for failed metrics
          analyzedMetrics.push({
            name: metric.name,
            target: metric.target,
            priority: metric.priority,
            actual: 'Analysis failed',
            status: 'fail' as const,
            confidence: 0,
            difference: 'N/A',
            analysis: 'Failed to analyze this metric.'
          });
        }
      }
      
      setMetricResults(analyzedMetrics);
      
      // Generate an overall recommendation based on the results
      if (analyzedMetrics.length > 0) {
        try {
          const recommendation = await apiGenerateRecommendation(
            analyzedMetrics,
            lab.status
          );
          setRecommendation(recommendation);
        } catch (error) {
          console.error("Error generating recommendation:", error);
          // Use fallback if API call fails
          setRecommendation({
            decision: "wait",
            confidence: 65,
            reasoning: "Recommendation analysis failed. Based on available metrics, it's suggested to wait for more data to make a final decision."
          });
        }
      }
    } catch (error) {
      console.error("Error analyzing lab metrics:", error);
      setAnalyzeError(error instanceof Error ? error : new Error('Unknown error during analysis'));
      toast({
        title: "Analysis Error",
        description: "Failed to analyze lab metrics. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Trigger analysis when lab, circles, or posts data changes
  // We deliberately don't include labCircles or circlePosts in dependencies to avoid infinite loops
  useEffect(() => {
    if (circlesError || postsError) {
      console.error("Circle or post errors:", { circlesError, postsError });
      setAnalyzeError(
        circlesError instanceof Error ? circlesError : 
        postsError instanceof Error ? postsError : 
        new Error('Failed to load lab data')
      );
      return;
    }
    
    // Only log minimal metrics info to avoid console flooding
    if (!isCirclesLoading && !isPostsLoading && labCirclesData && circlePostsData) {
      console.log(`Lab ${lab?.id} data loaded: ${labCirclesData.length} circles, ${circlePostsData.length} posts`);
      
      // Only run analysis when data is ready and not already analyzing
      if (!isAnalyzing) {
        analyzeLabMetrics();
      }
    }
  // Importantly, we only depend on the raw data sources and loading states, not derived objects
  }, [lab?.id, labCirclesData, circlePostsData, isCirclesLoading, isPostsLoading, circlesError, postsError, isAnalyzing]);
  
  // Function to retry analysis if it fails
  const retryAnalysis = () => {
    setAnalyzeError(null);
    analyzeLabMetrics();
  };

  return { 
    metricResults, 
    recommendation, 
    isAnalyzing, 
    analyzeError, 
    retryAnalysis 
  };
};