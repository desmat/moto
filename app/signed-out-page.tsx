"use client"

import { useEffect, useState } from 'react';
import { SignInButton, SignUpButton, useUser } from '@clerk/nextjs';
import {
  CircleUser,
  Gauge, Wrench, Cog,
  Motorbike,
  NotebookText, NotebookPen, ScrollText,
  Sparkles, Bot, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import "./globals.css";
import { cn } from '@/lib/utils';

const Steps = [
  { text: "Add your ride", icons: [Motorbike, Cog] },
  { text: "Log mileage and maintenance", icons: [Gauge, Wrench, ScrollText] },
  { text: "Journal rides, issues, work done", icons: [NotebookText, NotebookPen] },
  { text: "AI keeps track of what's due next", icons: [Bot, Sparkles, PartyPopper] },
];

const IntervalMs = 1500;

function StepCard({
  icons,
  cyclingIcons,
  visibleIcon,
  children,
}: {
  icons: any[],
  visibleIcon: number,
  cyclingIcons?: boolean,
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 hover:bg-slate-100 bg-slate-50 border-[1px] border-solid hover:border-gray-600 border-gray-400 rounded-md px-3 py-2 max-w-[80vw] sm:max-w-[10rem]", {
        "border-gray-600": cyclingIcons,
        "bg-slate-100": cyclingIcons,
      })}
    >
      <div className="flex gap-1">
        {icons?.slice(visibleIcon, visibleIcon + 1).map((Icon, i) => <Icon key={i} size="32" />)}
      </div>
      <div>{children}</div>
    </div>
  )
}

export default function SignedOutPage() {
  const { isLoaded } = useUser();
  let [cyclingCard, setCyclingCard] = useState<number>(0);
  let [cyclingIcon, setCyclingIcon] = useState<number>(0);
  let [cyclingCards, setCyclingCards] = useState(true);
  let [cyclingInterval, setCyclingInterval] = useState<any | null>(null);

  useEffect(() => {
    if (cyclingCards) {
      cyclingInterval = setInterval(() => {
        let nextIcon = cyclingIcon + 1;
        let nextCard = cyclingCard;

        if (nextIcon >= Steps[cyclingCard].icons.length) {
          nextIcon = 0;
          nextCard++;
        }

        if (nextCard >= Steps.length) {
          nextCard = 0;
        }

        cyclingIcon = nextIcon;
        setCyclingIcon(cyclingIcon);
        cyclingCard = nextCard;
        setCyclingCard(cyclingCard);
      }, IntervalMs);

      setCyclingInterval(cyclingInterval);
    }

    return () => {
      // console.log("SignedOutPage clearing interval", { cyclingInterval });
      cyclingInterval && clearInterval(cyclingInterval)
    };
  }, [cyclingCards]);

  return (
    <div className="min-h-screen px-4 sm:px-8 font-[family-name:var(--font-geist-sans)] flex flex-col">
      <header className="w-full pt-3 sm:pt-6 lg:pt-12">
        <div className="w-full flex sm:flex-row flex-col items-center justify-center sm:gap-2 gap-[0.1rem] text-lg">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Motorbike className="size-5" />
            </span>
            <span className="font-bold text-xl">MotoGPT</span>
          </div>
          <div className="sm:block hidden"> - </div>
          <div className="font-semibold">AI-powered motorcycle maintenance tracking</div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[calc(100%-2rem)]">
          <section className="w-full flex flex-col items-center justify-between gap-8 sm:gap-10 min-h-[28rem] sm:min-h-[20rem] lg:min-h-[16rem]">
            <div className="flex sm:flex-row flex-col items-center lg:gap-5 sm:gap-3 gap-2">
              {Steps.map((s, i) => (
                <HoverCard key={i}>
                  <HoverCardTrigger>
                    <StepCard
                      icons={s.icons}
                      cyclingIcons={cyclingCard == i}
                      visibleIcon={cyclingCard == i ? cyclingIcon : 0}
                    >
                      {s.text}
                    </StepCard>
                  </HoverCardTrigger>
                  {/* 
                  <HoverCardContent side="top" sideOffset={12}>
                    More details here, maybe some screenshots
                  </HoverCardContent> 
                  */}
                </HoverCard>
              ))}
            </div>

            <div>
              {!isLoaded &&
                <Button disabled={true} size="lg">
                  <Motorbike /> Get Started Now
                </Button>
              }
              {isLoaded &&
                <SignUpButton mode="modal">
                  <Button size="lg">
                    <Motorbike />Get Started Now
                  </Button>
                </SignUpButton>
              }
            </div>

            <div className="flex items-center gap-2">
              Already have an account?
              {!isLoaded &&
                <Button variant="outline" disabled={true}>
                  <CircleUser /> Login
                </Button>
              }
              {isLoaded &&
                <SignInButton mode="modal">
                  <Button variant="outline">
                    <CircleUser /> Login
                  </Button>
                </SignInButton>
              }
            </div>
          </section>
        </div>
      </main>

      <footer className="w-full pb-1">
        <Button className="w-fit mx-auto flex items-center gap-2 opacity-50 hover:opacity-100 decoration-teal-600" variant="link" color="blue"><a href="https://desmat.ca/">Hand-crafted with ❤️ by <span className="text-teal-600 font-semibold">desmat.ca</span></a></Button>
      </footer>
    </div>
  )
}
