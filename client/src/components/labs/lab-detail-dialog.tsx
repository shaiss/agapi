import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lab, Circle } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Archive,
  Beaker,
  CheckCircle,
  CircleSlash,
  Clipboard,
  FileText,
  Globe,
  Lock,
  PlayCircle,
  Plus,
  Settings,
  Trash,
  User,
  Users,
} from "lucide-react";
import LabCircleAddDialog from "./lab-circle-add-dialog";
import LabCircleRoleDialog from "./lab-circle-role-dialog";
import LabStatusChangeDialog from "./lab-status-change-dialog";
import { LabContentView } from "./lab-content-view";

interface LabDetailDialogProps {
  labId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

interface LabCircle extends Circle {
  role: "control" | "treatment" | "observation";
}

interface CircleStats {
  labCircle: {
    id: number;
    labId: number;
    circleId: number;
    role: "control" | "treatment" | "observation";
    addedAt?: Date;
  };
  circle: Circle;
  stats: {
    postCount: number;
    followerCount: number;
    memberCount: number;
  };
}

const getExperimentTypeLabel = (type: string) => {
  switch (type) {
    case "a_b_test": return "A/B Test";
    case "multivariate": return "Multivariate";
    case "exploration": return "Exploration";
    default: return type;
  }
};

const formatDate = (date: Date | string | null | undefined) => {
  if (!date) return "N/A";
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getRoleBadgeStyles = (role: string) => {
  switch (role) {
    case "control": return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";
    case "treatment": return "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20";
    case "observation": return "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20";
    default: return "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20";
  }
};

const LabDetailDialog = ({
  labId,
  open,
  onOpenChange,
  onUpdate,
}: LabDetailDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("info");
  const [isAddCircleOpen, setIsAddCircleOpen] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<LabCircle | null>(null);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [targetStatus, setTargetStatus] = useState<"draft" | "active" | "completed" | "archived" | null>(null);

  // Fetch lab details
  const {
    data: lab,
    isLoading: isLabLoading,
    error: labError,
    refetch: refetchLab,
  } = useQuery<Lab>({
    queryKey: [`/api/labs/${labId}`],
    enabled: open && !!labId,
  });

  // Fetch lab circles
  const {
    data: circles,
    isLoading: isCirclesLoading,
    error: circlesError,
    refetch: refetchCircles,
  } = useQuery<LabCircle[]>({
    queryKey: [`/api/labs/${labId}/circles`],
    enabled: open && !!labId && activeTab === "circles",
  });
  
  // Fetch enhanced circle stats
  const {
    data: circlesWithStats,
    isLoading: isStatsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery<CircleStats[]>({
    queryKey: [`/api/labs/${labId}/circles/stats`],
    enabled: open && !!labId && activeTab === "circles",
  });

  const handleStatusChange = async (newStatus: "active" | "draft" | "completed" | "archived") => {
    if (isUpdatingStatus || !lab) return;
    
    setIsUpdatingStatus(true);
    try {
      await apiRequest(`/api/labs/${labId}/status`, "PATCH", { status: newStatus });
      
      toast({
        title: "Status updated",
        description: `Lab status changed to ${newStatus}.`,
      });
      
      refetchLab();
      onUpdate();
    } catch (error) {
      toast({
        title: "Failed to update status",
        description: "There was an error updating the lab status.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const handleDeleteClick = () => {
    setIsDeleteConfirmOpen(true);
  };
  
  const handleDeleteLab = async () => {
    try {
      if (!labId) {
        toast({
          title: "Invalid lab",
          description: "Cannot delete the lab due to an invalid lab ID.",
          variant: "destructive",
        });
        return;
      }
      
      await apiRequest(`/api/labs/${labId}`, "DELETE");
      
      toast({
        title: "Lab deleted",
        description: "The lab has been deleted successfully.",
      });
      
      onOpenChange(false);
      onUpdate();
    } catch (error) {
      toast({
        title: "Failed to delete lab",
        description: "There was an error deleting the lab.",
        variant: "destructive",
      });
    }
  };

  const handleCircleUpdate = () => {
    refetchCircles();
    refetchStats();
    onUpdate();
  };

  const handleRemoveCircle = async (circleId?: number) => {
    // Don't proceed if the circle ID is undefined, null, or invalid
    if (!circleId) {
      toast({
        title: "Invalid circle",
        description: "Cannot remove circle due to invalid reference.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await apiRequest(`/api/labs/${labId}/circles/${circleId}`, "DELETE");
      
      toast({
        title: "Circle removed",
        description: "The circle has been removed from this lab.",
      });
      
      refetchCircles();
      refetchStats();
      onUpdate();
    } catch (error) {
      toast({
        title: "Failed to remove circle",
        description: "There was an error removing the circle.",
        variant: "destructive",
      });
    }
  };

  const getStatusActions = () => {
    if (!lab || !lab.status) return null;
    
    const actions = [];
    
    if (lab.status !== "active") {
      actions.push(
        <Button 
          key="activate"
          variant="outline" 
          onClick={() => setTargetStatus("active")}
          className="flex items-center gap-2"
        >
          <PlayCircle className="h-4 w-4" />
          Activate
        </Button>
      );
    }
    
    if (lab.status !== "completed") {
      actions.push(
        <Button 
          key="complete"
          variant="outline" 
          onClick={() => setTargetStatus("completed")}
          className="flex items-center gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          Complete
        </Button>
      );
    }
    
    if (lab.status !== "archived" && lab.status !== "draft") {
      actions.push(
        <Button 
          key="archive"
          variant="outline" 
          onClick={() => setTargetStatus("archived")}
          className="flex items-center gap-2"
        >
          <Archive className="h-4 w-4" />
          Archive
        </Button>
      );
    }
    
    actions.push(
      <Button 
        key="delete"
        variant="destructive" 
        onClick={handleDeleteClick}
        className="flex items-center gap-2"
      >
        <Trash className="h-4 w-4" />
        Delete
      </Button>
    );

    return (
      <div className="flex flex-wrap gap-2 mt-4">
        {actions}
      </div>
    );
  };

  return (
    <>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the lab and all of its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLab} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Beaker className="h-5 w-5" />
              {isLabLoading ? "Loading..." : lab?.name}
            </DialogTitle>
            <DialogDescription>
              {lab && lab.status && <Badge variant="outline">{lab.status.charAt(0).toUpperCase() + lab.status.slice(1)}</Badge>}
            </DialogDescription>
          </DialogHeader>

          {isLabLoading ? (
            <div className="py-8 text-center">
              <p>Loading lab details...</p>
            </div>
          ) : labError ? (
            <div className="py-8 text-center">
              <p className="text-destructive">Failed to load lab details.</p>
              <Button 
                variant="outline" 
                onClick={() => refetchLab()}
                className="mt-4"
              >
                Retry
              </Button>
            </div>
          ) : lab ? (
            <div>
              <Tabs defaultValue="info" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="info">Information</TabsTrigger>
                  <TabsTrigger value="circles">Circles</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                </TabsList>
                
                <TabsContent value="info" className="space-y-4 pt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Lab Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-sm font-semibold">Experiment Type</h4>
                          <p>{getExperimentTypeLabel(lab.experimentType)}</p>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold">Created</h4>
                          <p>{formatDate(lab.createdAt)}</p>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold">Last Updated</h4>
                          <p>{formatDate(lab.updatedAt)}</p>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold">Status</h4>
                          <p className="capitalize">{lab.status || "Unknown"}</p>
                        </div>
                      </div>
                      
                      {lab.description && (
                        <div>
                          <h4 className="text-sm font-semibold mb-1">Description</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-line">
                            {lab.description}
                          </p>
                        </div>
                      )}
                      
                      {lab.goals && (
                        <div>
                          <h4 className="text-sm font-semibold mb-1">Goals</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-line">
                            {lab.goals}
                          </p>
                        </div>
                      )}
                      
                      {lab.successMetrics?.metrics && lab.successMetrics.metrics.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Success Metrics</h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Metric</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Priority</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {lab.successMetrics.metrics.map((metric, index) => (
                                <TableRow key={index}>
                                  <TableCell>{metric.name}</TableCell>
                                  <TableCell>{metric.target}</TableCell>
                                  <TableCell className="capitalize">{metric.priority}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="flex-col items-start">
                      <h4 className="text-sm font-semibold mb-2">Lab Management</h4>
                      {getStatusActions()}
                    </CardFooter>
                  </Card>
                </TabsContent>
                
                <TabsContent value="circles" className="space-y-4 pt-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Circle Assignment</CardTitle>
                        <CardDescription>
                          Assign circles to different roles in your experiment
                        </CardDescription>
                      </div>
                      <Button onClick={() => setIsAddCircleOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Circle
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isCirclesLoading ? (
                        <div className="py-8 text-center">
                          <p>Loading circles...</p>
                        </div>
                      ) : circlesError ? (
                        <div className="py-8 text-center">
                          <p className="text-destructive">Failed to load circles.</p>
                          <Button 
                            variant="outline" 
                            onClick={() => refetchCircles()}
                            className="mt-4"
                          >
                            Retry
                          </Button>
                        </div>
                      ) : circles?.length === 0 ? (
                        <div className="py-8 text-center border rounded-md bg-muted/20">
                          <p className="text-muted-foreground mb-4">
                            No circles assigned to this lab yet.
                          </p>
                          <Button onClick={() => setIsAddCircleOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Circle
                          </Button>
                        </div>
                      ) : circlesWithStats && !isStatsLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                          {circlesWithStats.map((circle) => {
                            // Generate a unique, stable key that doesn't depend on circle.circle
                            const circleKey = circle.labCircle?.id || 
                                            circle.labCircle?.circleId || 
                                            `lab-circle-${Math.random().toString(36).substr(2, 9)}`;
                            
                            // Skip rendering if we don't have minimal required data
                            if (!circle.labCircle) {
                              return null;
                            }
                            
                            return (
                              <Card key={circleKey} className="overflow-hidden">
                                <CardHeader className="pb-2">
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <CardTitle className="text-base flex items-center">
                                        {circle.circle?.name || "Unknown Circle"}
                                      </CardTitle>
                                      <CardDescription className="text-xs mt-1">
                                        {circle.circle?.description?.substring(0, 60) || "No description"}
                                        {circle.circle?.description && circle.circle.description.length > 60 ? "..." : ""}
                                      </CardDescription>
                                    </div>
                                    <Badge 
                                      variant="outline" 
                                      className={getRoleBadgeStyles(circle.labCircle.role || "unknown")}
                                    >
                                      {(circle.labCircle.role ? `${circle.labCircle.role.charAt(0).toUpperCase()}${circle.labCircle.role.slice(1)}` : "Unknown")}
                                    </Badge>
                                  </div>
                                </CardHeader>
                                <CardContent className="pb-3">
                                  <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="flex items-center">
                                      <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                                      <span>{circle.stats?.memberCount || 0} members</span>
                                    </div>
                                    <div className="flex items-center">
                                      <User className="h-4 w-4 mr-2 text-muted-foreground" />
                                      <span>{circle.stats?.followerCount || 0} followers</span>
                                    </div>
                                    <div className="flex items-center">
                                      <span className="text-xs text-muted-foreground">Added {formatDate(circle.labCircle.addedAt)}</span>
                                    </div>
                                    <div className="flex items-center justify-end">
                                      {circle.circle?.visibility === "private" ? (
                                        <span className="flex items-center text-xs text-muted-foreground">
                                          <Lock className="h-3 w-3 mr-1" /> Private
                                        </span>
                                      ) : (
                                        <span className="flex items-center text-xs text-muted-foreground">
                                          <Globe className="h-3 w-3 mr-1" /> Shared
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </CardContent>
                                <div className="bg-muted/50 px-6 py-2 flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      // Get a valid circle ID from either source with proper null checks
                                      const circleId = circle.circle?.id || circle.labCircle?.circleId;
                                      
                                      if (circleId) {
                                        const labCircle = {
                                          id: circleId,
                                          name: circle.circle?.name || "Unknown Circle",
                                          role: (circle.labCircle && circle.labCircle.role) || "observation"
                                        };
                                        setSelectedCircle(labCircle as LabCircle);
                                        setIsRoleDialogOpen(true);
                                      } else {
                                        toast({
                                          title: "Invalid circle",
                                          description: "Cannot change role due to invalid circle reference.",
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                    className="h-8"
                                  >
                                    <Settings className="h-3.5 w-3.5 mr-1" />
                                    Change Role
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      // Try to get a valid circle ID with fallbacks
                                      const circleId = circle.circle?.id || circle.labCircle?.circleId;
                                      if (circleId) {
                                        handleRemoveCircle(circleId);
                                      } else {
                                        toast({
                                          title: "Invalid circle",
                                          description: "Cannot remove circle due to missing identifier.",
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                    className="h-8 text-destructive hover:text-destructive"
                                  >
                                    <CircleSlash className="h-3.5 w-3.5 mr-1" />
                                    Remove
                                  </Button>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Circle</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead className="w-[120px]">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {circles?.map((circle) => (
                              <TableRow key={circle.id}>
                                <TableCell>
                                  <div className="font-medium">{circle.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {circle.description?.substring(0, 50) || "No description"}
                                    {circle.description && circle.description.length > 50 ? "..." : ""}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant="outline" 
                                    className={getRoleBadgeStyles(circle.role || "unknown")}
                                  >
                                    {(circle.role ? `${circle.role.charAt(0).toUpperCase()}${circle.role.slice(1)}` : "Unknown")}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        if (circle && circle.id) {
                                          // Create a clean object with only the properties we need
                                          setSelectedCircle({
                                            id: circle.id,
                                            name: circle.name || "Unknown Circle",
                                            role: circle.role || "observation"
                                          } as LabCircle);
                                          setIsRoleDialogOpen(true);
                                        }
                                      }}
                                      title="Change role"
                                    >
                                      <Settings className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        if (circle && circle.id) {
                                          handleRemoveCircle(circle.id);
                                        }
                                      }}
                                      className="text-destructive"
                                      title="Remove from lab"
                                    >
                                      <CircleSlash className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                    <CardFooter>
                      <p className="text-xs text-muted-foreground">
                        <strong>Control:</strong> Baseline group with standard content<br />
                        <strong>Treatment:</strong> Experimental group with modified content<br />
                        <strong>Observation:</strong> Circle members can view but not participate
                      </p>
                    </CardFooter>
                  </Card>
                </TabsContent>
                
                <TabsContent value="content" className="space-y-4 pt-4">
                  <LabContentView labId={labId} />
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Circle dialogs */}
      {lab && (
        <>
          <LabCircleAddDialog
            labId={labId}
            open={isAddCircleOpen}
            onOpenChange={setIsAddCircleOpen}
            onSuccess={handleCircleUpdate}
            existingCircleIds={(circlesWithStats?.map(c => {
              // Try to get a valid circle ID from either circle object or labCircle.circleId
              const circleId = c.circle?.id || c.labCircle?.circleId || 0;
              return circleId;
            }).filter(id => id !== 0) || 
            circles?.map(c => c.id).filter(id => id !== undefined) || 
            [])}
          />
          
          {selectedCircle && selectedCircle.id && (
            <LabCircleRoleDialog
              labId={labId}
              circleId={selectedCircle.id}
              currentRole={selectedCircle.role || "observation"}
              circleName={selectedCircle.name || "Unknown Circle"}
              open={isRoleDialogOpen}
              onOpenChange={setIsRoleDialogOpen}
              onSuccess={handleCircleUpdate}
            />
          )}
          
          {targetStatus && lab && (
            <LabStatusChangeDialog
              labId={labId}
              currentStatus={lab.status || "draft"}
              newStatus={targetStatus}
              open={!!targetStatus}
              onOpenChange={(open) => {
                if (!open) setTargetStatus(null);
              }}
              onSuccess={() => {
                refetchLab();
                onUpdate();
              }}
            />
          )}
        </>
      )}
    </>
  );
};

export default LabDetailDialog;