import { formatDateTime } from '../lib/dateTime';

type BookingEvents = { created_at?: string | null; status: string; delivered_at?: string | null; rejected_at?: string | null };

export function BookingTimes({ booking }: { booking: BookingEvents }) {
  return <span className="event-times">
    <span>Booked {formatDateTime(booking.created_at)}</span>
    {booking.status === 'delivered' && <span>Delivered {formatDateTime(booking.delivered_at)}</span>}
    {(booking.status === 'rejected' || booking.status === 'cancelled') && <span>
      {booking.status === 'rejected' ? 'Rejected' : 'Cancelled'} {formatDateTime(booking.rejected_at)}
    </span>}
  </span>;
}
