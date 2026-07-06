import { listToMap, mapToList } from "@desmat/utils";
import { sortBy } from "@desmat/utils";

export const fromLocalStorage = (key: string, count?: number, offset?: number) => {
  if (typeof (localStorage) === "undefined") return {};

  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    const data = JSON.parse(cachedData);
    return typeof (count) === "number" || typeof (offset) === "number"
      ? listToMap(mapToList(data).sort(sortBy('createdAt', 'desc')).slice(offset || 0, count))
      : data;
  }
}

export const toLocalStorage = (key: string, data: any) => {
  if (typeof (localStorage) === "undefined") return;

  const cachedData = localStorage.getItem(key) || "{}";
  localStorage.setItem(key, JSON.stringify({ ...JSON.parse(cachedData), ...data }));
}
