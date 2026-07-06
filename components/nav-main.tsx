"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { usePathname } from "next/navigation"
import Link from "next/link"

export function NavMain({
  items,
}: {
  items: {
    title: any
    url?: string
    icon?: LucideIcon
    isActive?: boolean
    items?: {
      title: any
      url: string
    }[]
  }[]
}) {
  const pathname = usePathname();
  const sidebar = useSidebar();

  return (
    <SidebarGroup className="gap-0">
      {/* <SidebarGroupLabel>Main things</SidebarGroupLabel> */}
      <SidebarMenu className="gap-2">
        {items.map((item) => (
          <Collapsible
            key={item.title}
            asChild
            // defaultOpen={item.isActive}
            open={
              item.url
                ? pathname.startsWith(item.url)
                : undefined
            }
            defaultOpen={
              item.items?.length
                ? item.items.filter((subItem: any) => subItem.url == pathname).length > 0
                : undefined
            }
            className="group/collapsible"
          >
            <SidebarMenuItem>
              {item.url &&
                <CollapsibleTrigger asChild>
                  <Link
                    href={item.url}
                    onClick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}
                  >
                    <SidebarMenuButton tooltip={item.title} className="gap-2">
                      {item.icon && <item.icon style={{ width: "1.35rem", height: "1.35rem" }} />}
                      <span>{item.title}</span>
                      {item.items?.length && !item.url &&
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      }
                    </SidebarMenuButton>
                  </Link>
                </CollapsibleTrigger>
              }
              {!item.url &&
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon style={{ width: "1.35rem", height: "1.35rem" }} />}
                    <span>{item.title}</span>
                    {item.items?.length &&
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    }
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              }
              {item.items?.length &&
                <CollapsibleContent>
                  <SidebarMenuSub className="ml-[1rem] pl-[0.8rem]">
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild>
                          <Link
                            href={subItem.url}
                            onClick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}
                          >
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              }
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup >
  )
}
