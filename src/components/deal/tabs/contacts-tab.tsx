import { Mail, Phone, Building2 } from "lucide-react";
import type { Contact } from "@/types/database";
import { Card, CardBody } from "@/components/ui/card";

export function ContactsTab({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-sm italic text-ink-faint">
            No contacts linked to this deal yet.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {contacts.map((c) => (
        <Card key={c.contact_id}>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-ink-muted">
                {initials(c.name)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                <div className="truncate text-2xs text-ink-faint">{c.role}</div>
              </div>
            </div>
            <div className="space-y-1.5 border-t border-line pt-3 text-xs text-ink-muted">
              {c.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
                  {c.company}
                </div>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="flex items-center gap-2 hover:text-ink-muted">
                  <Mail className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
                  {c.email}
                </a>
              )}
              {c.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
                  {c.phone}
                </div>
              )}
            </div>
            {c.notes && (
              <p className="text-2xs italic text-ink-faint">{c.notes}</p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
