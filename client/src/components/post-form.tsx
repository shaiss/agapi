import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPostSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Loader2 } from "lucide-react";

interface PostFormProps {
  defaultCircleId?: number;
}

export function PostForm({ defaultCircleId }: PostFormProps) {
  const form = useForm({
    resolver: zodResolver(insertPostSchema),
    defaultValues: {
      content: "",
    },
  });

  const createPostMutation = useMutation({
    mutationFn: async (data: { content: string }) => {
      if (!defaultCircleId) {
        throw new Error("No circle selected");
      }

      const res = await apiRequest("POST", "/api/posts", {
        content: data.content,
        circleId: defaultCircleId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/circles/${defaultCircleId}/posts`] });
      form.reset({ content: "" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createPostMutation.mutate(data))}>
        <Card>
          <CardContent className="pt-6">
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder="What's on your mind?"
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button 
              type="submit"
              disabled={createPostMutation.isPending}
            >
              {createPostMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Post
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}