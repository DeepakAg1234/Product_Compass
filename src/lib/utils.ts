import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getUserDisplayName(user: any): string {
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  if (fullName) return fullName.split(" ")[0];
  const email = user?.email;
  if (email) return email.split("@")[0];
  return "there";
}
