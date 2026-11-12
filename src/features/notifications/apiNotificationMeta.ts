import { AlertCircle, XCircle } from "lucide-react";

import { API_NOTIFICATION_META } from "./components/NotificationList";

/** API-only notification types. Unknown types retain the existing neutral visual. */
export function getApiNotificationMeta(type: string): typeof API_NOTIFICATION_META {
  if (type === "RESCHEDULE_EXPIRED") {
    return { label: "재조정 기한 만료", icon: XCircle, className: "bg-gray-100 text-gray-600" };
  }
  if (type === "RESCHEDULE_REQUIRED") {
    return { label: "재조정 필요", icon: AlertCircle, className: "bg-red-50 text-red-600" };
  }
  return API_NOTIFICATION_META;
}
