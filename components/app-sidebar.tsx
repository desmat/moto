"use client"

import { Show, SignInButton, UserButton } from "@clerk/nextjs"
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu"
import {
  Bike,
  CircleUser,
  NotebookText,
  Sparkles,
} from "lucide-react"
import Link from "next/link"
import moment from "moment"
import * as React from "react"
import { NavMain } from "@/components/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUser } from "@/hooks/use-user";
import { isMockAuthEnabledClient, mockUser } from "@/lib/mock-auth";

export const AppLogo = Bike;

const data = {
  teams: [
    {
      name: "MotoGPT",
      logo: AppLogo,
      plan: "Maintenance tracker",
    },
  ],
}

export const NavItems = [
  {
    title: "Vehicles",
    url: "/vehicles",
    icon: Bike,
  },
  {
    title: "Logs",
    url: "/logs",
    icon: NotebookText,
  },
  {
    title: "Insights",
    url: "/insights",
    icon: Sparkles,
  },
  {
    title: "User",
    url: "/user",
    icon: CircleUser,
  },
]

function UserMenu({
  impersonatedUserId,
  sidebar,
  sidebarAnimating,
}: {
  impersonatedUserId: string | false | undefined,
  sidebar: ReturnType<typeof useSidebar>,
  sidebarAnimating: boolean,
}) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {impersonatedUserId &&
                <div
                  className="_bg-yellow-200 flex flex-row justify-center items-center gap-2 h-full"
                  title={`IMPERSONATING USER ${impersonatedUserId}`}
                >
                  <CircleUser
                    className="m-auto text-[hsl(var(--destructive))]"
                    style={{ width: "1.5rem", height: "1.5rem" }}
                  />
                  <div className="text-sm text-[hsl(var(--destructive))]">
                    {impersonatedUserId}
                  </div>
                </div>
              }
              {!impersonatedUserId &&
                <UserButton
                  showName={sidebar.state == "expanded" && !sidebarAnimating}
                  appearance={{
                    elements: {
                      userButtonBox: 'flex-row-reverse p-[0px]',
                      rootBox: "w-full",
                      userButtonTrigger: sidebar.state == "expanded" || sidebarAnimating
                        ? "w-full justify-start"
                        : "w-full",
                      userButtonOuterIdentifier: "p-0",
                    },
                  }}
                />
              }
            </SidebarMenuButton>
          </DropdownMenuTrigger>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const sidebar = useSidebar();
  const [sidebarAnimating, setSidebarAnimating] = React.useState(false);
  const activeTeam = data.teams[0];
  const { user, isLoaded: userLoaded } = useUser();
  const userIsAdmin = userLoaded && user?.publicMetadata?.isAdmin as boolean;
  // impersonation and mock-auth mode both stand in a fixed user id, so neither can render the real Clerk UserButton
  const impersonatedUserId = process.env.IMPERSONATE_USER_ID || (isMockAuthEnabledClient() && mockUser.id);

  React.useEffect(() => {
    setSidebarAnimating(true);
    setTimeout(() => setSidebarAnimating(false), 125);

  }, [sidebar.state])

  const logoIconBase = (
    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <activeTeam.logo className="size-4" />
    </div>
  );

  // build-time-injected (see next.config.mjs); admin-only since it's debug info, not
  // something regular users need
  const gitCommitSha = process.env.GIT_COMMIT_SHA;
  const gitCommitDate = process.env.GIT_COMMIT_DATE;

  const logoIcon = userIsAdmin && gitCommitSha
    ? (
      <Tooltip>
        <TooltipTrigger asChild>{logoIconBase}</TooltipTrigger>
        <TooltipContent side="right">
          {gitCommitSha && `git commit ${gitCommitSha.slice(0, 7)}`}
          {gitCommitDate && ` · ${moment(gitCommitDate).format("MMM D, YYYY h:mm A")}`}
        </TooltipContent>
      </Tooltip>
    )
    : logoIconBase;

  return (
    <Sidebar
      collapsible="offcanvas"
      variant="sidebar"
      {...props}
    >
      <SidebarHeader>
        <Link
          href="/"
          onClick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}
        >
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mt-[-0.25rem] ml-[-0.25rem]"
          >
            {logoIcon}
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                {activeTeam.name}
              </span>
              <span className="truncate text-xs">{activeTeam.plan}</span>
            </div>
          </SidebarMenuButton>
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1">
        {/* @ts-ignore */}
        <NavMain items={NavItems} />
      </SidebarContent>
      <SidebarFooter>
        {/* Show requires a mounted ClerkProvider, which mock-auth mode skips entirely */}
        {!isMockAuthEnabledClient() &&
          <Show when="signed-out">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                      <SignInButton
                        mode="modal"
                        fallbackRedirectUrl="fallbackRedirectUrl"
                        forceRedirectUrl="forceRedirectUrl"
                        signUpFallbackRedirectUrl="signUpFallbackRedirectUrl"
                        signUpForceRedirectUrl="signUpForceRedirectUrl"
                      >
                        <div className="flex flex-row gap-3 items-center">
                          <CircleUser className="w-[28px] h-[28px]" />
                          {sidebar.state == "expanded" && !sidebarAnimating &&
                            "Sign in"
                          }
                        </div>
                      </SignInButton>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </Show>
        }
        {isMockAuthEnabledClient()
          ? <UserMenu impersonatedUserId={impersonatedUserId} sidebar={sidebar} sidebarAnimating={sidebarAnimating} />
          : <Show when="signed-in">
            <UserMenu impersonatedUserId={impersonatedUserId} sidebar={sidebar} sidebarAnimating={sidebarAnimating} />
          </Show>
        }
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
