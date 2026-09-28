/**
 * Wire types for the notification bell — US-COMP-01.
 *
 * NOTIFICATIONS ARE DERIVED, NOT STORED. Each one is worked out from the
 * current state of the data every time the bell is read — a licence inside its
 * warning period, for example — so a notification disappears the moment its
 * cause is fixed. Only the per-user READ STATE is stored.
 *
 * `key` is what makes that work. It describes the situation, not the record:
 * `licence-expiry:<licence id>:<expiry date>:<status>`. When the situation
 * changes — "expires soon" becomes "has expired", or a renewal moves the date —
 * the key changes, so the new situation arrives unread even if the old one had
 * been read.
 */

export const NOTIFICATION_KINDS = ['LICENCE_EXPIRY'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** `critical` needs action now (red); `warning` needs action soon (amber). */
export type NotificationSeverity = 'critical' | 'warning';

/** Upper bound on a key's length, matching the column that stores read state. */
export const NOTIFICATION_KEY_MAX_LENGTH = 200;

export interface NotificationItem {
  key: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  message: string;
  /** Where clicking the notification takes you, as an app path. */
  href: string;
  read: boolean;
}

export interface NotificationFeed {
  /** Unread first, then by severity. */
  items: NotificationItem[];
  unreadCount: number;
}

/** Marks some notifications read, or unread again. */
export interface MarkNotificationsRequest {
  keys: string[];
  read: boolean;
}

/** Where a licence notification sends you: the alert on the dashboard. */
export const LICENCE_ALERT_HREF = '/dashboard#licence-alert';
