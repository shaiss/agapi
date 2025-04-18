import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Post, AiFollower } from "@shared/schema";
import { Heart, MessageSquare, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { subscribeToWebSocket } from "@/lib/websocket";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface PostCardProps {
  post: Post & {
    interactions: Array<{
      id: number;
      type: "like" | "comment";
      content?: string;
      aiFollowerId?: number;
      aiFollower?: AiFollower;
      parentId?: number;
      createdAt: Date;
    }>;
  };
}

function ReplyForm({ postId, commentId, aiFollowerName, onReply }: {
  postId: number;
  commentId: number;
  aiFollowerName: string;
  onReply: () => void;
}) {
  const { user } = useAuth();
  const form = useForm({
    defaultValues: {
      content: "",
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      const res = await apiRequest(`/api/posts/${postId}/reply`, "POST", {
        content,
        parentId: commentId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/posts/${user?.id}`] });
      form.reset();
      onReply();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => replyMutation.mutate(data))} className="flex items-center space-x-2">
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input {...field} placeholder={`Reply to ${aiFollowerName}...`} />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" size="icon" disabled={replyMutation.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Form>
  );
}

function Comment({
  comment,
  postId,
  replies,
  level = 0,
}: {
  comment: PostCardProps["post"]["interactions"][0];
  postId: number;
  replies: PostCardProps["post"]["interactions"];
  level?: number;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(true);

  const commentReplies = replies.filter((reply) => reply.parentId === comment.id);
  const hasReplies = commentReplies.length > 0;

  const isAIComment = !!comment.aiFollowerId;

  return (
    <div className={`space-y-4 ${level > 0 ? "ml-8 border-l-2 pl-4" : ""}`}>
      <div className="flex items-start space-x-4">
        <Avatar className="h-8 w-8">
          {isAIComment && comment.aiFollower?.avatarUrl && (
            <img
              src={comment.aiFollower.avatarUrl}
              alt={comment.aiFollower.name}
              className="h-full w-full object-cover"
            />
          )}
          <AvatarFallback>
            {isAIComment ? comment.aiFollower?.name[0] || 'AI' : 'U'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="text-sm font-medium mb-1">
            {isAIComment ? comment.aiFollower?.name || 'AI' : 'You'}
          </p>
          <p className="text-sm">{comment.content}</p>
          <div className="flex items-center space-x-2 mt-2">
            {!isReplying && isAIComment && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReplying(true)}
              >
                Reply
              </Button>
            )}
            {hasReplies && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReplies(!showReplies)}
              >
                {showReplies ? "Hide Replies" : "Show Replies"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {isReplying && (
        <div className="ml-8">
          <ReplyForm
            postId={postId}
            commentId={comment.id}
            aiFollowerName={comment.aiFollower?.name || "AI"}
            onReply={() => setIsReplying(false)}
          />
        </div>
      )}

      {showReplies && commentReplies.map((reply) => (
        <Comment
          key={reply.id}
          comment={reply}
          postId={postId}
          replies={replies}
          level={level + 1}
        />
      ))}
    </div>
  );
}

export function PostCard({ post }: PostCardProps) {
  const [interactions, setInteractions] = useState(post.interactions);
  const { user } = useAuth();

  useEffect(() => {
    // Subscribe to real-time updates for this post
    const unsubscribe = subscribeToWebSocket(`post-${post.id}`, (data) => {
      // Handle thread update messages
      if (data.type === 'thread-update' && data.postId === post.id) {
        setInteractions(prev => {
          // Find and replace the updated thread
          return prev.map(interaction => 
            interaction.id === data.thread.id ? data.thread : interaction
          );
        });
      } 
      // Handle new interaction
      else if (data.postId === post.id) {
        setInteractions(prev => {
          // Check if this interaction already exists
          const exists = prev.some(i => i.id === data.id);
          if (!exists) {
            return [...prev, data];
          }
          return prev;
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [post.id]);

  // Subscribe to thread updates
  useEffect(() => {
    if (!post?.id) return;

    console.log(`Subscribing to WebSocket updates for post ${post.id}`);
    const unsubscribe = subscribeToWebSocket('thread-update', (data) => {
      console.log('Received thread update via WebSocket:', data);
      if (data.postId === post.id && data.thread) {
        queryClient.setQueryData([`/api/posts/${user?.id}`], (oldData: any) => {
          if (!oldData) return oldData;

          return oldData.map((p: any) => {
            if (p.id === post.id) {
              // Find if this thread already exists in interactions
              const threadExists = p.interactions.some((i: any) => i.id === data.thread.id);

              if (threadExists) {
                // Replace the existing thread
                return {
                  ...p,
                  interactions: p.interactions.map((i: any) => {
                    if (i.id === data.thread.id) {
                      return data.thread;
                    }
                    return i;
                  })
                };
              } else {
                // Add new thread to interactions
                return {
                  ...p,
                  interactions: [...p.interactions, data.thread]
                };
              }
            }
            return p;
          });
        });

        // Invalidate query to ensure we get the latest data
        queryClient.invalidateQueries({ queryKey: [`/api/posts/${user?.id}`] });
      }
    });

    return () => {
      console.log(`Unsubscribing from WebSocket updates for post ${post.id}`);
      unsubscribe();
    };
  }, [post.id, queryClient, user?.id]);


  const likes = interactions.filter((i) => i.type === "like").length;
  const comments = interactions.filter(
    (i) => i.type === "comment" && !i.parentId
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center space-x-4">
        <Avatar>
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm text-muted-foreground">
            {new Date(post.createdAt?.toString() || "").toLocaleDateString()}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap">{post.content}</p>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="flex items-center space-x-4 text-muted-foreground">
          <div className="flex items-center space-x-1">
            <Heart className="h-4 w-4" />
            <span className="text-sm">{likes}</span>
          </div>
          <div className="flex items-center space-x-1">
            <MessageSquare className="h-4 w-4" />
            <span className="text-sm">{comments.length}</span>
          </div>
        </div>
        <div className="space-y-6">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              postId={post.id}
              replies={interactions}
            />
          ))}
        </div>
      </CardFooter>
    </Card>
  );
}