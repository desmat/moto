'use client'

import { useState } from 'react';
import { cn } from '@/lib/utils';
import "./globals.css";
import { SIDEBAR_WIDTH, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { NoSsr } from '@/components/no-ssr';
import OnboardingInterview from '@/components/onboarding-interview';
import SetupVehicleDialog from '@/components/setup-vehicle-dialog';
import { useVehicle } from '@/hooks/use-vehicle';

export default function SignedInPageMain({
  children,
}: {
  children: React.ReactNode
}) {
  const { open, isMobile } = useSidebar();
  const { loaded: vehiclesLoaded, vehicles, add: addVehicle } = useVehicle();
  // the just-created first vehicle, held from addVehicle's response so the AI
  // onboarding interview (S13) can follow the forced setup dialog for that vehicle
  const [interviewVehicle, setInterviewVehicle] = useState<any>();

  // first-run onboarding: force the add-a-vehicle dialog until the user has one
  const showSetupDialog = vehiclesLoaded && vehicles && Object.keys(vehicles).length == 0;

  const addFirstVehicle = async (vehicle: any) => {
    const created = await addVehicle(vehicle);
    // the successful create closes the setup dialog (the vehicles refetch flips
    // showSetupDialog); open the optional interview for the new vehicle
    created?.id && setInterviewVehicle(created);
    return created;
  }

  return (
    <main
      className="_bg-pink-20 w-full md:duration-200 ease-linear"
      style={{
        maxWidth: open && !isMobile ? `calc(100% - ${SIDEBAR_WIDTH})` : "100%",
      }}
    >
      <div
        className="_bg-pink-200 fixed z-50 flex flex-row align-middle justify-start gap-0 _w-full pr-2"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.8)"
        }}
      >
        <SidebarTrigger
          className={cn("bg-none hover:opacity-100 fixed md:block hidden mt-[1px] ml-[4px] transition-all", {
            "opacity-30": open,
          })}
          style={{
            left: open ? "calc(var(--sidebar-width) - 2rem)" : "0",
            transitionDuration: "0.2s",
            transitionTimingFunction: "linear",
          }}
        />
      </div>
      <div className="w-full items-center justify-items-center min-h-screen px-4 sm:px-8 md:pt-6 pt-4 pb-[6rem] md:pb-[2rem] gap-0 font-[family-name:var(--font-geist-sans)]">
        <div className="_bg-yellow-200 flex flex-col gap-8 items-center sm:items-start w-full max-w-[1200px]">
          <NoSsr>
            {children}
          </NoSsr>
        </div>
      </div>
      <NoSsr>
        <SetupVehicleDialog
          forced
          show={!!showSetupDialog}
          onSubmit={addFirstVehicle}
        />
        <OnboardingInterview
          vehicle={interviewVehicle}
          open={!!interviewVehicle}
          onOpenChange={(open: boolean) => !open && setInterviewVehicle(undefined)}
        />
      </NoSsr>
    </main>
  )
}
