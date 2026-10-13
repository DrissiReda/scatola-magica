"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/_components/GlobalComponents/Layout/Modal";
import Button from "@/app/_components/GlobalComponents/Buttons/Button";
import IconButton from "@/app/_components/GlobalComponents/Buttons/IconButton";
import Input from "@/app/_components/GlobalComponents/Form/Input";
import Switch from "@/app/_components/GlobalComponents/Form/Switch";
import {
  getShare,
  listUsernames,
  updateShare,
} from "@/app/_server/actions/shares";

interface ShareModalProps {
  itemId: string;
  itemName: string;
  onClose: () => void;
}

export default function ShareModal({ itemId, itemName, onClose }: ShareModalProps) {
  const router = useRouter();
  const [users, setUsers] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [wasShared, setWasShared] = useState(false);
  const [known, setKnown] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getShare(itemId).then((result) => {
      if (!result.data) return;
      setUsers(result.data.users);
      setCanEdit(result.data.canEdit);
      setWasShared(result.data.users.length > 0);
    });
    listUsernames().then(setKnown);
  }, [itemId]);

  const addDraft = () => {
    const name = draft.trim();
    if (name && !users.includes(name)) setUsers([...users, name]);
    setDraft("");
  };

  const save = async (nextUsers: string[]) => {
    setIsSaving(true);
    setError("");
    const result = await updateShare(itemId, { users: nextUsers, canEdit });
    setIsSaving(false);
    if (!result.success) return setError(result.error || "Failed to share");
    router.refresh();
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title={`Share "${itemName}"`} size="md">
      <div className="p-6 space-y-5">
        <Input
          label="Add people"
          list="share-usernames"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          onBlur={addDraft}
          placeholder="Username"
          autoFocus
        />
        <datalist id="share-usernames">
          {known
            .filter((name) => !users.includes(name))
            .map((name) => (
              <option key={name} value={name} />
            ))}
        </datalist>

        {error && <p className="text-sm text-error">{error}</p>}

        {users.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="share-users">
            {users.map((name) => (
              <span
                key={name}
                className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-surface-variant text-sm"
              >
                {name}
                <IconButton
                  icon="close"
                  size="sm"
                  ariaLabel={`Remove ${name}`}
                  onClick={() => setUsers(users.filter((u) => u !== name))}
                />
              </span>
            ))}
          </div>
        )}

        <Switch label="Can edit" checked={canEdit} onChange={setCanEdit} />

        <div className="flex items-center justify-end gap-3 pt-2">
          {wasShared && (
            <Button
              variant="text"
              onClick={() => save([])}
              disabled={isSaving}
              className="mr-auto text-error"
            >
              Stop sharing
            </Button>
          )}
          <Button variant="outlined" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="filled"
            onClick={() => save(users)}
            disabled={isSaving || (users.length === 0 && !wasShared)}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
