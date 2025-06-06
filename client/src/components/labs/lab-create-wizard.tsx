import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import type { Circle, InsertLabTemplate } from "@shared/schema";
import { LabTemplateData } from "./lab-template-selector";

// Define a type for metrics to avoid casting issues
type MetricItem = {
  name: string;
  target: string | number;
  priority: "high" | "medium" | "low";
};
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Beaker, Plus, Trash, Check, X, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import LabTemplateSelector from "@/components/labs/lab-template-selector";
import LabCircleSelector from "@/components/labs/lab-circle-selector";

interface LabCreateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSuccess: () => void;
}

// Define validation schema
const labSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters").max(100),
  experimentType: z.enum(["a_b_test", "single_variant"]),
  description: z.string().optional(),
  goals: z.string().optional(),
  successMetrics: z
    .object({
      metrics: z
        .array(
          z.object({
            name: z.string().min(1, "Metric name is required"),
            target: z.number().min(0, "Target value must be non-negative"),
            priority: z.enum(["high", "medium", "low"]),
          })
        )
        .optional(),
    })
    .optional(),
  // This is just for the form and won't be sent directly to the API
  circles: z.array(
    z.object({
      id: z.number(),
      role: z.enum(["control", "treatment", "observation"]).default("treatment"),
    })
  ).optional(),
  // Content created during lab setup
  labContent: z
    .array(
      z.object({
        content: z.string().min(1, "Post content is required"),
        circleId: z.number().optional(),
      })
    )
    .default([]),
});

type LabFormValues = z.infer<typeof labSchema>;

const LabCreateWizard = ({
  open,
  onOpenChange,
  onCreateSuccess,
}: LabCreateWizardProps) => {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch circles for content targeting
  const { data: circles } = useQuery<{
    private: Circle[];
    public: Circle[];
  }>({
    queryKey: ["/api/circles"],
  });
  
  const steps = [
    { title: "Basic Information", description: "Enter lab name and type" },
    { title: "Goals", description: "Define lab purpose and goals" },
    { title: "Success Metrics", description: "Set metrics to measure success" },
    { title: "Content", description: "Create content for testing" },
  ];

  // Set up form with default values
  // We'll use the Lab Circle Selector component instead of fetching circles here
  // The component itself handles data fetching

  const form = useForm<LabFormValues>({
    resolver: zodResolver(labSchema),
    defaultValues: {
      name: "",
      experimentType: "a_b_test",
      description: "",
      goals: "",
      successMetrics: {
        metrics: [],
      },
      circles: [],
      labContent: [],
    },
  });

  const { watch, setValue, getValues } = form;
  
  const applyTemplate = (template: LabTemplateData) => {
    // Apply the template values to the form
    setValue("goals", template.goals);
    
    // Convert template metrics (if any) to the form format
    if (template.successMetrics && template.successMetrics.metrics) {
      // Convert metrics with proper typing to avoid type issues
      const typedMetrics = (template.successMetrics.metrics as MetricItem[]).map(metric => ({
        name: metric.name,
        target: typeof metric.target === 'number' ? metric.target : parseFloat(metric.target) || 0,
        priority: metric.priority
      }));
      
      setValue("successMetrics.metrics", typedMetrics);
    }
    
    // Also update experiment type if it matches one of our valid types
    if (template.experimentType && (
      template.experimentType === "a_b_test" || 
      template.experimentType === "multivariate" || 
      template.experimentType === "exploration"
    )) {
      setValue("experimentType", template.experimentType);
    }
    
    toast({
      title: "Template applied",
      description: `The "${template.name}" template has been applied.`,
    });
  };
  const metrics = watch("successMetrics.metrics") || [];
  const labContent = watch("labContent") || [];

  const addMetric = () => {
    const currentMetrics = getValues("successMetrics.metrics") || [];
    setValue("successMetrics.metrics", [
      ...currentMetrics,
      { name: "", target: 0, priority: "medium" },
    ]);
  };

  const removeMetric = (index: number) => {
    const currentMetrics = getValues("successMetrics.metrics") || [];
    setValue(
      "successMetrics.metrics",
      currentMetrics.filter((_, i) => i !== index)
    );
  };
  
  const addLabContent = () => {
    const currentContent = getValues("labContent") || [];
    setValue("labContent", [
      ...currentContent,
      { content: "", circleId: undefined },
    ]);
  };

  const removeLabContent = (index: number) => {
    const currentContent = getValues("labContent") || [];
    setValue(
      "labContent",
      currentContent.filter((_, i) => i !== index)
    );
  };

  const handleNext = async (e?: React.MouseEvent) => {
    // If an event is passed, prevent default behavior
    if (e) {
      e.preventDefault();
    }
    
    const currentValues = getValues();
    let isValid = false;

    if (currentStep === 0) {
      const { name, experimentType } = currentValues;
      isValid = !!(name && name.length >= 3 && experimentType);
    } else if (currentStep === 1) {
      // Goals are optional, so we can always proceed
      isValid = true;
    } else if (currentStep === 2) {
      // Metrics are optional
      isValid = true;
    } else if (currentStep === 3) {
      // Content is optional
      isValid = true;
    }

    if (isValid) {
      if (currentStep < steps.length - 1) {
        // Move to the next step
        setCurrentStep((prev) => prev + 1);
      } else {
        // This is the last step, submit the form manually
        await onSubmit(currentValues);
      }
    } else {
      // Trigger validation to show errors
      form.trigger();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const onSubmit = async (data: LabFormValues) => {
    setIsSubmitting(true);
    try {
      // Extract the circles data from the form
      const { circles, labContent, ...labData } = data;
      
      // Define type for the created lab
      let createdLab: { id: number; [key: string]: any };
      
      // Create the lab first without any circle association
      createdLab = await apiRequest("/api/labs", "POST", labData);
      
      // If circles are selected, add them to the lab after creation
      if (circles && circles.length > 0) {
        try {
          // Add each circle to the lab with its role
          const circlePromises = circles.map(circleObj => 
            apiRequest(`/api/labs/${createdLab.id}/circles`, "POST", {
              circleId: circleObj.id,
              role: circleObj.role
            })
          );
          
          await Promise.all(circlePromises);
        } catch (circleError) {
          console.warn("Some circles may not have been added to the lab:", circleError);
          // Continue with lab creation even if some circles failed to be added
        }
      }
      
      // If lab content was created, store it with the lab
      if (labContent && labContent.length > 0 && createdLab) {
        try {
          // Store each piece of content with the lab (not as posts yet)
          const contentPromises = labContent.map(content => 
            apiRequest(`/api/labs/${createdLab.id}/content`, "POST", {
              content: content.content,
              targetRole: content.targetRole
            })
          );
          
          await Promise.all(contentPromises);
        } catch (contentError) {
          console.warn("Some lab content could not be stored:", contentError);
          // Continue with lab creation even if content storage fails
        }
      }
      
      toast({
        title: "Lab created",
        description: "Your new experiment lab has been created successfully.",
      });
      
      onOpenChange(false);
      onCreateSuccess();
      
      // Reset form
      form.reset();
      setCurrentStep(0);
    } catch (error: any) {
      console.error("Error creating lab:", error);
      
      // Check if we have a successful lab creation response despite the error
      // This can happen if the main lab creation succeeds but adding circles or content fails
      const errorResponseData = error?.response?.data;
      const hasLabId = typeof error?.labId === 'number' || (errorResponseData && typeof errorResponseData.id === 'number');
      
      if (hasLabId) {
        toast({
          title: "Lab created with issues",
          description: "Your lab was created, but some secondary operations may have failed. You can still use the lab.",
          variant: "default",
        });
        
        // Close the wizard and refresh the labs list
        onOpenChange(false);
        onCreateSuccess();
        
        // Reset form
        form.reset();
        setCurrentStep(0);
      } else {
        // Complete failure - lab wasn't created
        toast({
          title: "Failed to create lab",
          description: "There was an error creating the lab. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="h-5 w-5" />
            Create Content Lab
          </DialogTitle>
          <DialogDescription>
            Set up a new experiment to test content strategies.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 mt-2">
          <div className="flex justify-between mb-2">
            {steps.map((step, index) => (
              <div 
                key={index} 
                className={`text-center px-2 ${
                  index === currentStep 
                    ? "text-primary" 
                    : index < currentStep 
                      ? "text-muted-foreground" 
                      : "text-muted-foreground/50"
                }`}
              >
                <div className="flex items-center mb-1 gap-2 justify-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    index === currentStep 
                      ? "bg-primary text-primary-foreground" 
                      : index < currentStep 
                        ? "bg-primary/20 text-primary" 
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {index + 1}
                  </div>
                  <span className="text-sm font-medium hidden sm:inline">{step.title}</span>
                </div>
                <span className="text-xs hidden sm:block">{step.description}</span>
              </div>
            ))}
          </div>
          <div className="w-full bg-muted h-1 mb-6 mt-2 rounded-full overflow-hidden">
            <div 
              className="bg-primary h-full transition-all duration-300 rounded-full"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <Form {...form}>
          {/* 
  IMPORTANT: We must use the expanded form with e.preventDefault() instead of 
  simply passing form.handleSubmit(onSubmit) directly.

  This prevents events from template application (Apply Template button)
  or other buttons from accidentally triggering form submission.
  
  Without this, applying a template in the wizard would immediately submit the form.
*/}
          <form onSubmit={(e) => { 
            e.preventDefault(); 
            form.handleSubmit(onSubmit)(e); 
          }} className="space-y-4">
            {/* Step 1: Basic Information */}
            {currentStep === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                  <CardDescription>
                    Enter the essential details for your experiment lab.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lab Name</FormLabel>
                        <FormControl>
                          <Input placeholder="E.g., 'Q1 Content Strategy Test'" {...field} />
                        </FormControl>
                        <FormDescription>
                          A clear, descriptive name for your experiment.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe the purpose and context of this experiment..."
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Provide context for other team members.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="experimentType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Experiment Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select experiment type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="a_b_test">A/B Test - Compare different content variants</SelectItem>
                            <SelectItem value="single_variant">Single Variant - Test content effectiveness vs baseline</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {form.watch("experimentType") === "a_b_test" && 
                            "A/B Test: Create different content variants for different circles to compare performance."
                          }
                          {form.watch("experimentType") === "single_variant" && 
                            "Single Variant: Test one content variant against baseline (no content) to measure effectiveness."
                          }
                          {!form.watch("experimentType") && 
                            "Choose how you want to test your content with different audiences."
                          }
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 2: Goals */}
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Goals</CardTitle>
                  <CardDescription>
                    Define what you want to achieve with this experiment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="border rounded-md p-4 bg-muted/20 mb-6">
                    <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Lab Templates
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Save time by selecting a pre-defined template for common experiment types. Templates include recommended goals and metrics.
                    </p>
                    <LabTemplateSelector onSelectTemplate={applyTemplate} isWizardMode={true} />
                  </div>

                  <FormField
                    control={form.control}
                    name="goals"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Goals</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What specific goals are you trying to achieve?"
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          List the specific outcomes you're looking for.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 3: Success Metrics */}
            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Success Metrics</CardTitle>
                  <CardDescription>
                    Define how you'll measure the success of this experiment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium">Metrics</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addMetric}
                        className="text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Metric
                      </Button>
                    </div>

                    {metrics.length === 0 ? (
                      <div className="text-center py-8 border rounded-md bg-muted/20">
                        <p className="text-sm text-muted-foreground">
                          No metrics added yet. Add some metrics to track success.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addMetric}
                          className="mt-4"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Metric
                        </Button>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Metric</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead>Priority</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {metrics.map((metric, index) => (
                            <TableRow key={index}>
                              <TableCell>
                                <Input
                                  placeholder="Metric name"
                                  value={metric.name}
                                  onChange={(e) => {
                                    const updated = [...metrics];
                                    updated[index].name = e.target.value;
                                    setValue("successMetrics.metrics", updated);
                                  }}
                                  className="w-full"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  placeholder="Target"
                                  value={metric.target}
                                  onChange={(e) => {
                                    const updated = [...metrics];
                                    updated[index].target = parseFloat(e.target.value);
                                    setValue("successMetrics.metrics", updated);
                                  }}
                                  className="w-full"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={metric.priority}
                                  onValueChange={(value) => {
                                    const updated = [...metrics];
                                    updated[index].priority = value as "high" | "medium" | "low";
                                    setValue("successMetrics.metrics", updated);
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Priority" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="high">High</SelectItem>
                                    <SelectItem value="medium">Medium</SelectItem>
                                    <SelectItem value="low">Low</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeMetric(index)}
                                  className="h-8 w-8 text-destructive"
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Metrics help you measure success and make data-driven decisions.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 4: Content Creation */}
            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Content Creation</CardTitle>
                  <CardDescription>
                    Create content for your experiment to test with different audience segments.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Show experiment type guidance */}
                  {form.watch("experimentType") && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm font-medium text-blue-900 mb-1">
                        {form.watch("experimentType") === "a_b_test" ? "A/B Test Setup" : "Single Variant Test Setup"}
                      </p>
                      <p className="text-xs text-blue-700">
                        {form.watch("experimentType") === "a_b_test" 
                          ? "Create different content variants for different circles. Each variant will be compared against the others."
                          : "Create one content variant that will be tested against a baseline (no content) control group."
                        }
                      </p>
                    </div>
                  )}
                  
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium">
                        {form.watch("experimentType") === "a_b_test" ? "Content Variants" : "Test Content"}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addLabContent}
                        className="text-xs"
                        disabled={form.watch("experimentType") === "single_variant" && labContent.length >= 1}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Content
                      </Button>
                    </div>

                    {labContent.length === 0 ? (
                      <div className="text-center py-8 border rounded-md bg-muted/20">
                        <p className="text-sm text-muted-foreground">
                          No content added yet. Add content to test with your audience.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addLabContent}
                          className="mt-4"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Content
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {labContent.map((content, index) => (
                          <div key={index} className="border rounded-md p-4 space-y-3">
                            <div className="flex justify-between items-start">
                              <p className="text-sm font-medium">Content #{index + 1}</p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeLabContent(index)}
                                className="h-8 w-8 text-destructive"
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            </div>
                            
                            <div className="space-y-3">
                              <div>
                                <label className="text-sm font-medium mb-1 block">Content</label>
                                <Textarea
                                  placeholder="Enter your post content here..."
                                  value={content.content}
                                  onChange={(e) => {
                                    const updated = [...labContent];
                                    updated[index].content = e.target.value;
                                    setValue("labContent", updated);
                                  }}
                                  className="min-h-[100px]"
                                />
                              </div>
                              
                              <div>
                                <label className="text-sm font-medium mb-1 block">Target Circle</label>
                                <Select
                                  value={content.circleId?.toString() || ""}
                                  onValueChange={(value) => {
                                    const updated = [...labContent];
                                    updated[index].circleId = value ? parseInt(value) : undefined;
                                    setValue("labContent", updated);
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a circle" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {circles?.private?.map((circle) => (
                                      <SelectItem key={circle.id} value={circle.id.toString()}>
                                        {circle.name}
                                      </SelectItem>
                                    ))}
                                    {circles?.public?.map((circle) => (
                                      <SelectItem key={circle.id} value={circle.id.toString()}>
                                        {circle.name} (Public)
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground mt-1">
                                  This content will be posted to the selected circle for testing
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Create different content variations to test with your audience segments.
                      Content will be distributed based on the targeting rules you select.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </form>
        </Form>

        <DialogFooter className="flex justify-between mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            Back
          </Button>
          <div>
            <Button
              type="button"
              variant="outline"
              className="mr-2"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={(e) => handleNext(e)}
              disabled={isSubmitting}
            >
              {currentStep < steps.length - 1
                ? "Next"
                : isSubmitting
                ? "Creating..."
                : "Create Lab"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LabCreateWizard;