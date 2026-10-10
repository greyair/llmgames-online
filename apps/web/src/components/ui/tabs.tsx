import { Tabs as Primitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export const Tabs = Primitive.Root;

export function TabsList({ className, children, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List className={cn("ui-tabs-list", className)} {...props}>
      {children}
      <Primitive.Indicator className="ui-tabs-indicator" />
    </Primitive.List>
  );
}

export function TabsTrigger({ className, ...props }: Primitive.Tab.Props) {
  return <Primitive.Tab className={cn("ui-tabs-trigger", className)} {...props} />;
}

export function TabsContent({ className, ...props }: Primitive.Panel.Props) {
  return <Primitive.Panel className={cn("ui-tabs-content", className)} {...props} />;
}
