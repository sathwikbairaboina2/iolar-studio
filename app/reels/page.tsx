import { redirect } from 'next/navigation';

/** The reel category lives at /reel; this keeps the old nav key working. */
export default function Page() {
  redirect('/reel');
}
