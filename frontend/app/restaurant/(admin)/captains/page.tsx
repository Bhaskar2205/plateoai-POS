'use client';

import { KeyRound, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { canManageTables } from '@/lib/permissions';
import { useAuth } from '@/lib/auth-context';
import {
  useCreateStaff,
  useResetStaffPassword,
  useStaff,
  useUpdateStaff,
} from '@/lib/queries';
import type { StaffMember, UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

/**
 * The floor: who may take orders, and what they sign in with.
 *
 * The reason this screen exists is attribution. Orders record who opened them,
 * and the staff report ranks by that - but only if each captain has their own
 * account. One shared login for the whole floor makes every figure here
 * meaningless, so adding somebody is deliberately quick.
 *
 * A password is set here and never read back. There is no route that returns
 * one, because there is no use for one: hand it to the captain directly, and if
 * it is lost, set a new one.
 */

const ROLE_LABEL: Record<string, string> = {
  RESTAURANT_OWNER: 'Owner',
  RESTAURANT_MANAGER: 'Manager',
  WAITER: 'Captain',
  KITCHEN_STAFF: 'Kitchen',
  SUPER_ADMIN: 'Plateo',
};

export default function CaptainsPage() {
  const { session } = useAuth();
  const toast = useToast();
  const allowed = canManageTables(session?.user.role);

  const staff = useStaff({ enabled: allowed });
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<StaffMember | null>(null);
  const [switchingOff, setSwitchingOff] = useState<StaffMember | null>(null);

  const update = useUpdateStaff({
    onSuccess: () => {
      setSwitchingOff(null);
      toast.success('Updated.');
    },
    onError: (error) => toast.error(error),
  });

  if (!allowed) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">Only the owner manages who works here.</p>
        </CardBody>
      </Card>
    );
  }

  const people = staff.data ?? [];
  const captains = people.filter((person) => person.code !== null);
  const others = people.filter((person) => person.code === null);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Captain app"
          description="Give each waiter their own code so you can see who is selling what. They sign in at captain.plateoai.in."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add a captain
            </Button>
          }
        />

        {captains.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">
              Nobody has a code yet. Add a captain and hand them their code and password — there is
              nothing to install, they open captain.plateoai.in on their own phone.
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {captains.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold',
                    person.isActive ? 'bg-brand-50 text-brand-700' : 'bg-ground text-muted',
                  )}
                >
                  {person.name.slice(0, 1).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{person.name}</p>
                  <p className="text-xs text-muted">
                    Code <span className="font-semibold text-ink">{person.code}</span> ·{' '}
                    {ROLE_LABEL[person.role] ?? person.role}
                  </p>
                </div>

                {!person.isActive && <Badge tone="neutral">Switched off</Badge>}

                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setResetting(person)}>
                    <KeyRound className="size-4" aria-hidden />
                    New password
                  </Button>
                  {person.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => setSwitchingOff(person)}>
                      Switch off
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={update.isPending}
                      onClick={() => update.mutate({ id: person.id, isActive: true })}
                    >
                      Switch on
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHeader
            title="Signs in with an email"
            description="Owners and managers use the POS, not the captain app."
          />
          <ul className="divide-y divide-line">
            {others.map((person) => (
              <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                <p className="min-w-0 flex-1 truncate text-sm text-ink">{person.name}</p>
                <span className="text-xs text-muted">{ROLE_LABEL[person.role] ?? person.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddCaptainDialog open={adding} onClose={() => setAdding(false)} />

      <ResetPasswordDialog person={resetting} onClose={() => setResetting(null)} />

      <ConfirmDialog
        open={switchingOff !== null}
        title={switchingOff ? `Switch off ${switchingOff.name}?` : 'Switch off'}
        message="They are signed out on their next tap and cannot sign in again until you switch them back on. Everything they have already sold stays on the reports."
        confirmLabel="Switch off"
        loading={update.isPending}
        onCancel={() => setSwitchingOff(null)}
        onConfirm={() => switchingOff && update.mutate({ id: switchingOff.id, isActive: false })}
      />
    </div>
  );
}

/** Adding somebody to the floor. */
function AddCaptainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('WAITER');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateStaff({
    onSuccess: () => {
      toast.success(`${name} can sign in now. Give them their code and password.`);
      setName('');
      setCode('');
      setPassword('');
      setError(null);
      onClose();
    },
    onError: (caught) => setError(caught.message),
  });

  const ready =
    name.trim().length >= 2 &&
    /^[a-z0-9.-]{3,32}$/.test(code.trim().toLowerCase()) &&
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  return (
    <Modal
      open={open}
      title="Add a captain"
      description="They sign in on their own phone with a code and a password. Nothing to install."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!ready}
            onClick={() =>
              create.mutate({ name: name.trim(), code: code.trim().toLowerCase(), password, role })
            }
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
            {error}
          </p>
        )}

        <TextField
          label="Name"
          placeholder="Ramesh Kumar"
          hint="Shown on the reports, so use the name you would say out loud."
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label="Code"
          placeholder="ramesh"
          hint="What they type to sign in. Letters, numbers, dots and hyphens. Must be unique across Plateo."
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />

        <TextField
          label="Password"
          hint="At least 8 characters with an uppercase letter, a lowercase letter and a number. Write it down — you cannot read it back."
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
          >
            <option value="WAITER">Captain — takes orders, cannot discount or settle</option>
            <option value="RESTAURANT_MANAGER">Manager — can also discount and settle</option>
            <option value="KITCHEN_STAFF">Kitchen — the kitchen screen only</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({
  person,
  onClose,
}: {
  person: StaffMember | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');

  const reset = useResetStaffPassword({
    onSuccess: () => {
      toast.success('New password set. Hand it to them directly.');
      setPassword('');
      onClose();
    },
    onError: (error) => toast.error(error),
  });

  const ready =
    password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);

  return (
    <Modal
      open={person !== null}
      title={person ? `New password for ${person.name}` : 'New password'}
      description="Plateo never emails it — these accounts have no address. Write it down and hand it over."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button
            loading={reset.isPending}
            disabled={!ready}
            onClick={() => person && reset.mutate({ id: person.id, password })}
          >
            Set password
          </Button>
        </>
      }
    >
      <TextField
        label="New password"
        hint="At least 8 characters with an uppercase letter, a lowercase letter and a number."
        maxLength={128}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
    </Modal>
  );
}
