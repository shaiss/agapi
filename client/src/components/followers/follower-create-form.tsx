import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { useCreateFollower } from "@/lib/mutations/follower-mutations";

function generateUniqueAvatarUrl() {
  const randomSeed = Math.random().toString(36).substring(7);
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${randomSeed}`;
}

export const responsivenessOptions = [
  { value: "instant", label: "Instant (< 5 min)", description: "Quick to respond, always online" },
  { value: "active", label: "Active (5-60 min)", description: "Regular social media user" },
  { value: "casual", label: "Casual (1-8 hrs)", description: "Checks occasionally" },
  { value: "zen", label: "Zen (8-24 hrs)", description: "Mindful and deliberate responses" },
] as const;

export function FollowerCreateForm() {
  const createFollowerMutation = useCreateFollower();
  
  const form = useForm({
    defaultValues: {
      name: "",
      personality: "",
      avatarUrl: generateUniqueAvatarUrl(),
      responsiveness: "active" as const,
    },
  });

  return (
    <Form {...form}>
      <form 
        onSubmit={form.handleSubmit((data) => {
          createFollowerMutation.mutate({
            ...data,
            avatarUrl: generateUniqueAvatarUrl(),
          });
          form.reset({
            name: "",
            personality: "",
            avatarUrl: generateUniqueAvatarUrl(),
            responsiveness: "active",
          });
        })} 
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Enter follower name" />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="personality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Personality</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder="Describe the follower's personality (e.g., 'Enthusiastic tech nerd who loves blockchain')"
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="responsiveness"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Responsiveness</FormLabel>
              <Select 
                value={field.value} 
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select responsiveness level" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {responsivenessOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div>{option.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Determines how quickly and often the AI follower responds to posts
              </FormDescription>
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={createFollowerMutation.isPending}>
          {createFollowerMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Create Follower
        </Button>
      </form>
    </Form>
  );
}
