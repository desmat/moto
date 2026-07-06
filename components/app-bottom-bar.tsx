'use client'

import Link from "next/link"
import { useRouter } from "next/navigation";
import { AppLogo, NavItems } from '@/components/app-sidebar';
import { AlignJustify, CircleUser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserButton } from '@clerk/nextjs';
import { isMockAuthEnabledClient, mockUser } from "@/lib/mock-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


function MoreMenu({
  items,
  children,
}: {
  items: any[],
  children: React.ReactNode,
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-fit">
        {items.map((item, i) => (
          <DropdownMenuItem
            key={`nav-item-${i}`}
            className="_bg-orange-200 p-0 _w-full px-3 py-3 flex gap-3 cursor-pointer"
            onClick={() => router.push(item.url)}
          >
            {item.icon && <item.icon className="size-5" />}
            <div className="text-sm">{item.title}</div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppBottomBar() {
  // impersonation and mock-auth mode both stand in a fixed user id, so neither can render the real Clerk UserButton
  const impersonatedUserId = process.env.IMPERSONATE_USER_ID || (isMockAuthEnabledClient() && mockUser.id);

  const navItems = [
    {
      title: "Home",
      icon: AppLogo,
      url: "/"
    },
    ...NavItems,
  ];

  const menuItems = [
    ...navItems,
  ];

  // trim what's visible bottom and menu
  navItems.splice(3);
  menuItems.splice(0, 3);

  return (
    <div
      className="_bg-pink-200 bg-sidebar  color-sidebar md:hidden fixed bottom-0 left-0 w-full h-[4.25rem] z-50 flex gap-2 justify-evenly content-bottom py-1"
      style={{ borderTop: "solid 1px hsl(var(--sidebar-border))" }}
    >
      {navItems.map((item, i) => (
        <Link
          key={`nav-item-${i}`}
          className="_bg-yellow-200 _m-auto _mt-auto _mb-2 px-2 rounded-md flex flex-col justify-center h-full hover:bg-[hsl(var(--sidebar-accent))]"
          // @ts-ignore
          href={item.url}
        >
          <div
            className="mx-auto size-6 w-fit flex-grow content-center"
            style={{ display: "-webkit-flex" }}
          >
            {/* @ts-ignore */}
            <item.icon className={cn("m-auto", {
              "size-6": i != 0,
              "size-7": i == 0,
              "rounded-lg": i == 0,
              "bg-sidebar-primary": i == 0,
              "text-sidebar-primary-foreground": i == 0,
            })} />
          </div>
          {/* @ts-ignore */}
          <div className="text-sm">{item.title}</div>
        </Link>
      ))}

      <MoreMenu items={menuItems} >
        <div
          key={`nav-item-more`}
          className="_bg-yellow-200 _m-auto _mt-auto _mb-2 px-2 rounded-md flex flex-col justify-center h-full hover:bg-[hsl(var(--sidebar-accent))] outline-none"
        >
          <div
            className="mx-auto size-6 w-fit flex-grow content-center"
            style={{ display: "-webkit-flex" }}
          >
            <AlignJustify className="m-auto size-6" />
          </div>
          <div className="text-sm">More</div>
        </div>
      </MoreMenu>

      <div key={`nav-item-user`}
        className="_bg-yellow-200 flex flex-col justify-center h-full"
        title={impersonatedUserId ? `IMPERSONATING USER ${impersonatedUserId}` : undefined}
      >
        <div className="_bg-orange-200 mx-auto flex-grow content-center mt-1 -mb-1">
          {impersonatedUserId &&
            <CircleUser className="m-auto size-6 text-[hsl(var(--destructive))]" />
          }
          {!impersonatedUserId &&
            <UserButton
              showName={false}
            />
          }
        </div>
        <div className={cn("text-sm", {
          "text-[hsl(var(--destructive))]": impersonatedUserId
        })}>Profile</div>
      </div>
    </div>
  )
}
