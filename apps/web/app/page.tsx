// Root "/" → redirect to app picker
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}
