import { redirect } from 'next/navigation';
import { homeTarget } from '@/lib/ui/homeTarget';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(homeTarget(await searchParams));
}
