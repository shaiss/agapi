import { useAuth } from "@/hooks/use-auth";
import { NavBar } from "@/components/nav-bar";
import { PostForm } from "@/components/posts/post-form";
import { PostCard } from "@/components/posts/post-card";
import { useQuery } from "@tanstack/react-query";
import { Post, Circle } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useCallback, useState } from "react";
import { createWebSocket, subscribeToWebSocket } from "@/lib/websocket";
import { CirclePanel } from "@/components/circle-panel";

export default function HomePage() {
  const { user } = useAuth();
  const [circleId, setCircleId] = useState<number | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  
  // Fetch default circle
  const { data: defaultCircle } = useQuery<Circle>({
    queryKey: ["/api/default-circle"],
    enabled: !!user && !circleId,
  });

  // Redirect to default circle if no circle is specified
  useEffect(() => {
    if (defaultCircle && !circleId && window.location.search === '') {
      // Navigate to default circle
      window.history.pushState({}, '', `/?circle=${defaultCircle.id}`);
      setCircleId(defaultCircle.id);
    }
  }, [defaultCircle, circleId]);

  // Parse circle ID from URL query parameters and update when location changes
  useEffect(() => {
    // Create a function to handle URL changes
    const handleUrlChange = () => {
      console.log("URL change detected, updating circle ID");
      const params = new URLSearchParams(window.location.search);
      const circleParam = params.get('circle');
      if (circleParam && !isNaN(parseInt(circleParam, 10))) {
        setCircleId(parseInt(circleParam, 10));
      } else {
        setCircleId(null);
      }
    };
    
    // Initial call
    handleUrlChange();
    
    // Listen for popstate events (browser back/forward)
    window.addEventListener('popstate', handleUrlChange);
    
    // Create a custom event we can dispatch when using programmatic navigation
    window.addEventListener('locationchange', handleUrlChange);
    
    // Also track URL changes from history.pushState
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    // And from replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('locationchange', handleUrlChange);
      // Restore original history methods
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  // Query for posts - either circle posts or user posts
  const { data: posts, isLoading, refetch } = useQuery<(Post & { interactions: any[] })[]>({
    queryKey: circleId ? [`/api/circles/${circleId}/posts`] : [`/api/posts/${user?.id}`],
    enabled: !!user && (circleId !== null || true),
  });

  // Query for circle details if we're in circle view
  const { data: circleDetails } = useQuery<Circle>({
    queryKey: [`/api/circles/${circleId}`],
    enabled: !!circleId && !!user,
  });

  // Handle real-time updates, properly handling both user and circle post updates
  const handleWebSocketMessage = useCallback((data: any) => {
    // Determine if this update is relevant to the current view
    const isRelevantUpdate = 
      // For regular thread and post updates
      (data.type === 'thread-update' || data.type === 'post-update') ||
      // For circle-specific updates
      (circleId && data.circleId === circleId);
      
    if (isRelevantUpdate) {
      refetch();
    }
  }, [refetch, circleId]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (user) {
      const ws = createWebSocket();
      const unsubscribe = subscribeToWebSocket('*', handleWebSocketMessage);

      return () => {
        unsubscribe();
        if (ws) {
          ws.close();
        }
      };
    }
  }, [user, handleWebSocketMessage]);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <div className="flex h-[calc(100vh-4rem)]"> 
        {circleId && (
          <CirclePanel 
            circleId={circleId} 
            isCollapsed={isPanelCollapsed}
            onCollapse={setIsPanelCollapsed} 
          />
        )}
        
        <main className="flex-1 overflow-auto py-6 px-4">
          <div className="max-w-2xl mx-auto space-y-6">
            <PostForm defaultCircleId={circleId || undefined} />
            
            {circleDetails && (
              <div className="flex items-center space-x-2 mb-4">
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                  style={{ backgroundColor: circleDetails.color + '20' }}
                >
                  {circleDetails.icon}
                </div>
                <h1 className="text-2xl font-bold">{circleDetails.name}</h1>
              </div>
            )}

            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-12 w-[250px]" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ))
            ) : Array.isArray(posts) ? posts.map((post) => (
              <PostCard key={post.id} post={post} />
            )) : (
              <div className="text-center py-6 text-muted-foreground">
                No posts available for this circle
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}