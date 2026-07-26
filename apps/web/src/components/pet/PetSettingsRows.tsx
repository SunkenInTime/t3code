import { useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { usePrimaryEnvironment } from "~/state/environments";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow } from "../settings/settingsLayout";
import { PetPickerDialog, usePetCatalog } from "./PetLayer";

export function PetSettingsRows() {
  const environment = usePrimaryEnvironment();

  if (!environment) return null;
  return <PetSettingsRowsForEnvironment environmentId={environment.environmentId} />;
}

function PetSettingsRowsForEnvironment({
  environmentId,
}: {
  environmentId: Parameters<typeof usePetCatalog>[0];
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const pets = usePetCatalog(environmentId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = pets.find((pet) => pet.id === settings.petId);

  return (
    <>
      <SettingsRow
        title="Coding companion"
        description="Show a Codex-compatible animated pet that reacts to agent activity, including Claude Code sessions."
        control={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              {selected?.displayName ?? "Choose pet"}
            </Button>
            <Switch
              checked={settings.petEnabled}
              onCheckedChange={(checked) => updateSettings({ petEnabled: Boolean(checked) })}
              aria-label="Show coding companion"
            />
          </div>
        }
      />
      <SettingsRow
        className="bg-muted/20 sm:pl-9"
        title="Pet animations"
        description="Animate state changes, reactions, and movement. Reduced-motion system preferences still take precedence."
        control={
          <Switch
            checked={settings.petAnimations}
            onCheckedChange={(checked) => updateSettings({ petAnimations: Boolean(checked) })}
            aria-label="Animate coding companion"
          />
        }
      />
      <PetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        pets={pets}
        selectedId={settings.petId}
        animationsEnabled={settings.petAnimations}
        onSelect={(petId) => updateSettings({ petEnabled: true, petId })}
      />
    </>
  );
}
