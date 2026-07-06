import { usePathname } from 'next/navigation'
import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { upperCaseFirstLetter } from '@desmat/utils/format';

const pageNames = {
  "/vehicles": "Vehicles",
  "/logs": "Logs",
  "/user": "User",
  "/insights": "Insights",
};

export function AppBreadcrumbs({ ...props }: React.ComponentProps<typeof Breadcrumb>) {
  const path = usePathname();

  const lastPath = path.split("/").reverse()[0];
  const pageNamesEntry = Object.entries(pageNames).find(([k, v]) => path.startsWith(k)) || ["/", undefined];
  const pageName = pageNamesEntry && pageNamesEntry[1] || lastPath;
  const altPageName = ["edit"].includes(lastPath)
    ? upperCaseFirstLetter(lastPath)
    : lastPath;
  console.log("components.app-breadcrumps", { path, lastPath, pageNamesEntry, pageName, altPageName });

  return (
    <Breadcrumb className="_bg-pink-200">
      <BreadcrumbList>
        {path != "/" &&
          <>
            <BreadcrumbSeparator className="md:block hidden">|</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {path == pageNamesEntry[0] &&
              <BreadcrumbItem>
                <BreadcrumbPage>{pageName}</BreadcrumbPage>
              </BreadcrumbItem>
            }
            {path != pageNamesEntry[0] &&
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink href={pageNamesEntry[0]}>{pageName}</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{altPageName}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            }
          </>
        }

      </BreadcrumbList>
    </Breadcrumb>
  )
}