import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@vbaas/ui/components/sidebar";

import { AppSidebar } from "@/components/app-sidebar";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { buildAuthPageSearch } from "@/lib/auth-routing";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession().catch(() => ({ data: null }));

    if (!session.data?.user) {
      throw redirect({
        to: "/login",
        search: buildAuthPageSearch(location.href),
      });
    }

    return { session };
  },
  pendingComponent: Loader,
  component: AppLayout,
});

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
