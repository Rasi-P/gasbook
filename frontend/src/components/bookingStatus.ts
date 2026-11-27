import type { BadgeTone } from './ui/Badge';

/** Badge tone for a booking status (presentation only; statuses themselves are unchanged). */
export function bookingStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'pending': return 'warning';
    case 'approved':
    case 'accepted': return 'info';
    case 'out_for_delivery': return 'primary';
    case 'delivered': return 'success';
    case 'rejected':
    case 'cancelled': return 'danger';
    default: return 'neutral';
  }
}

/** Badge tone for a delivery status shown alongside a booking. */
export function deliveryStatusTone(status: string): BadgeTone {
  if (status === 'accepted') return 'info';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}
