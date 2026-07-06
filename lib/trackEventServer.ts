import { TrackingEventData, TrackingEventType } from "@/types/TrackingEvent";
import { track } from '@vercel/analytics/server';

export default async function trackEvent(event: TrackingEventType, data?: TrackingEventData) {
  console.log("utils.trackEventServer", { event, data });
  await track(event, data);
}
