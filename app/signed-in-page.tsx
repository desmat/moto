'use client'

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { toast } from "sonner";
import { AppBottomBar } from '@/components/app-bottom-bar';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import SignedInPageMain from './signed-in-page-main';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => toast.error(`An error occured: ${error}`)
  })
});

export default function SignedInPage({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <AppSidebar />
        <AppBottomBar />
        <SignedInPageMain>
          {children}
        </SignedInPageMain>
      </SidebarProvider>
    </QueryClientProvider>
  )
}
