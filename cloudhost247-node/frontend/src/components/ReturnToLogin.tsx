import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { authLink } from '../lib/return-to';

/** Sign in and return to the page where the visitor started their task. */
export default function ReturnToLogin({ children, className, destination }: {
  children: ReactNode;
  className?: string;
  destination?: string;
}) {
  const location = useLocation();
  return <Link className={className} to={authLink('/login', destination ?? `${location.pathname}${location.search}${location.hash}`)}>{children}</Link>;
}
