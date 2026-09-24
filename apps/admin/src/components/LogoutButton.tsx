import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout, ME_KEY } from '../api';

/** POST /admin/auth/logout with the CSRF header, then re-read /me (which shows the login page). */
export function LogoutButton({ csrf }: { csrf: string | null }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => logout(csrf),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });
  return (
    <button
      type="button"
      className="secondary"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      Log out
    </button>
  );
}
