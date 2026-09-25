import { Injectable, InternalServerErrorException } from '@nestjs/common';

import {
  LICENCE_ALERT_HREF,
  LICENCE_TYPE_LABELS,
  LICENCE_VISIBLE_TO,
  type LicenceSummary,
  type NotificationFeed,
  type NotificationItem,
  type UserRole,
} from '@pharma-erp/types';

import { LicencesService } from '../licences/licences.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

type Notification = Omit<NotificationItem, 'read'>;

/**
 * The notification bell — US-COMP-01.
 *
 * Notifications are DERIVED from live data on every read, one source per kind.
 * Adding a kind means adding a source to `current()`; the bell, the read state
 * and the endpoints do not change. Each source decides who may see its
 * notifications, the same way the dashboard sections do.
 *
 * Only read state is stored (`notification_reads`), keyed by the
 * notification's key — see packages/types/src/notifications.ts for why the key
 * describes the situation rather than the record.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly licences: LicencesService,
  ) {}

  async feed(): Promise<NotificationFeed> {
    const userId = this.requireUserId();
    const [notifications, readKeys] = await Promise.all([this.current(), this.readKeys(userId)]);

    return toFeed(notifications, readKeys);
  }

  /**
   * Marks notifications read or unread, then returns the updated feed.
   *
   * Marking read only records keys that are CURRENTLY in this person's feed, so
   * the table cannot be filled with keys for notifications they were never
   * shown. The same pass prunes rows for notifications that no longer exist —
   * a renewed licence, say — which is what keeps the table from growing.
   */
  async mark(keys: string[], read: boolean): Promise<NotificationFeed> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.requireUserId();
    const notifications = await this.current();
    const currentKeys = notifications.map((notification) => notification.key);

    if (read) {
      const valid = new Set(currentKeys);
      const toMark = [...new Set(keys)].filter((key) => valid.has(key));

      if (toMark.length > 0) {
        await this.prisma.scoped.notificationRead.createMany({
          data: toMark.map((notificationKey) => ({ tenantId, userId, notificationKey })),
          skipDuplicates: true,
        });
      }

      await this.prisma.scoped.notificationRead.deleteMany({
        where: { userId, notificationKey: { notIn: currentKeys } },
      });
    } else {
      await this.prisma.scoped.notificationRead.deleteMany({
        where: { userId, notificationKey: { in: keys } },
      });
    }

    return toFeed(notifications, await this.readKeys(userId));
  }

  /** Every notification this person should currently see. */
  private async current(): Promise<Notification[]> {
    const role = this.tenantContext.get()?.role ?? null;

    const sources = await Promise.all([this.licenceExpiry(role)]);

    return sources.flat();
  }

  /** Admin and Quality Officer only — the same rule as the licence register. */
  private async licenceExpiry(role: UserRole | null): Promise<Notification[]> {
    if (!role || !LICENCE_VISIBLE_TO.includes(role as (typeof LICENCE_VISIBLE_TO)[number])) {
      return [];
    }

    const { licences } = await this.licences.expiring();

    return licences.map(toLicenceNotification);
  }

  private async readKeys(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.scoped.notificationRead.findMany({
      where: { userId },
      select: { notificationKey: true },
    });

    return new Set(rows.map((row) => row.notificationKey));
  }

  /** Unreachable through the guard chain; a 500 beats writing a row for nobody. */
  private requireUserId(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) throw new InternalServerErrorException('No user on the request context.');

    return userId;
  }
}

function toFeed(notifications: Notification[], readKeys: Set<string>): NotificationFeed {
  const items = notifications
    .map((notification) => ({ ...notification, read: readKeys.has(notification.key) }))
    // Unread first, then critical before warning. Stable, so each source's own
    // order survives within a group.
    .sort(
      (a, b) =>
        Number(a.read) - Number(b.read) ||
        Number(a.severity !== 'critical') - Number(b.severity !== 'critical'),
    );

  return { items, unreadCount: items.filter((item) => !item.read).length };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The key carries the expiry date and the status, so a renewal or the step
 * from EXPIRING to EXPIRED produces a new, unread notification.
 */
function toLicenceNotification(licence: LicenceSummary): Notification {
  const label = LICENCE_TYPE_LABELS[licence.licenceType];
  const expired = licence.status === 'EXPIRED';
  const days = Math.abs(licence.daysUntilExpiry);

  const message = expired
    ? `${licence.licenceNumber} expired on ${licence.expiryDate}, ${plural(days, 'day')} ago. Renew it now.`
    : days === 0
      ? `${licence.licenceNumber} expires today (${licence.expiryDate}).`
      : `${licence.licenceNumber} expires on ${licence.expiryDate}, in ${plural(days, 'day')}.`;

  return {
    key: `licence-expiry:${licence.id}:${licence.expiryDate}:${licence.status}`,
    kind: 'LICENCE_EXPIRY',
    severity: expired ? 'critical' : 'warning',
    title: expired ? `${label} has expired` : `${label} expires soon`,
    message,
    href: LICENCE_ALERT_HREF,
  };
}
