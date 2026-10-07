import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import { useModels } from "../../../api/hooks";
import type { CreateRunRequest, ProgramInput, RunOptions } from "../../../api/types";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Spinner } from "../../../components/ui/Spinner";

const MODALITIES = [
  "small_molecule",
  "antibody",
  "biologic_other",
  "cell_therapy",
  "gene_therapy",
  "oligonucleotide",
  "vaccine",
  "other",
] as const;
const STAGES = [
  "discovery",
  "preclinical",
  "ind_enabling",
  "phase1",
  "phase2",
  "phase3",
  "filed",
  "approved",
] as const;
const EFFORTS = ["low", "medium", "high", "panel"] as const;

interface FormState {
  indication: string;
  mechanism: string;
  drug_name: string;
  modality: string;
  stage: string;
  preclinical_results: string;
  biomarkers: string;
  route: string;
  notes: string;
  links: string;
  effort: (typeof EFFORTS)[number];
  model: string;
  panel_size: number;
}

const EMPTY: FormState = {
  indication: "",
  mechanism: "",
  drug_name: "",
  modality: "",
  stage: "",
  preclinical_results: "",
  biomarkers: "",
  route: "",
  notes: "",
  links: "",
  effort: "medium",
  model: "",
  panel_size: 3,
};

const blankToUndefined = (value: string) => value.trim() || undefined;

function toRequest(form: FormState): CreateRunRequest {
  const program: ProgramInput = {
    indication: form.indication.trim(),
    mechanism: form.mechanism.trim(),
    drug_name: blankToUndefined(form.drug_name),
    modality: (form.modality || undefined) as ProgramInput["modality"],
    stage: (form.stage || undefined) as ProgramInput["stage"],
    preclinical_results: blankToUndefined(form.preclinical_results),
    biomarkers: blankToUndefined(form.biomarkers),
    route: blankToUndefined(form.route),
    notes: blankToUndefined(form.notes),
    links: form.links
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
  const options: RunOptions = {
    effort: form.effort,
    model: form.model || undefined,
    ...(form.effort === "panel" ? { panel_size: form.panel_size } : {}),
  };
  return { program, options };
}

const field = "w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-muted mb-1";

export function Composer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const models = useModels();
  const [form, setForm] = useState<FormState>(EMPTY);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: async (body: CreateRunRequest) => (await getApi()).createRun(body),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/underwriting/runs/${run.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(toRequest(form));
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-white p-3">
      <div>
        <label className={label} htmlFor="indication">
          Indication
        </label>
        <input
          id="indication"
          required
          className={field}
          value={form.indication}
          onChange={(e) => set("indication", e.target.value)}
          placeholder="Alzheimer's disease"
        />
      </div>
      <div>
        <label className={label} htmlFor="mechanism">
          Mechanism or target
        </label>
        <input
          id="mechanism"
          required
          className={field}
          value={form.mechanism}
          onChange={(e) => set("mechanism", e.target.value)}
          placeholder="BACE1 inhibition"
        />
      </div>

      <details className="rounded-md border border-line p-2">
        <summary className="cursor-pointer text-sm font-medium">More about the program</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={label} htmlFor="drug_name">
              Drug name
            </label>
            <input id="drug_name" className={field} value={form.drug_name} onChange={(e) => set("drug_name", e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="route">
              Route
            </label>
            <input id="route" className={field} value={form.route} onChange={(e) => set("route", e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="modality">
              Modality
            </label>
            <select id="modality" className={field} value={form.modality} onChange={(e) => set("modality", e.target.value)}>
              <option value="">unspecified</option>
              {MODALITIES.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="stage">
              Stage
            </label>
            <select id="stage" className={field} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
              <option value="">unspecified</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="biomarkers">
              Biomarkers
            </label>
            <input id="biomarkers" className={field} value={form.biomarkers} onChange={(e) => set("biomarkers", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="preclinical">
              Preclinical results
            </label>
            <textarea id="preclinical" rows={2} className={field} value={form.preclinical_results} onChange={(e) => set("preclinical_results", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="notes">
              Notes
            </label>
            <textarea id="notes" rows={2} className={field} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="links">
              Links (one per line)
            </label>
            <textarea id="links" rows={2} className={field} value={form.links} onChange={(e) => set("links", e.target.value)} />
          </div>
        </div>
      </details>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor="effort">
            Effort
          </label>
          <select id="effort" className={field} value={form.effort} onChange={(e) => set("effort", e.target.value as FormState["effort"])}>
            {EFFORTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="model">
            Model
          </label>
          <select id="model" className={field} value={form.model} onChange={(e) => set("model", e.target.value)}>
            <option value="">cheapest available</option>
            {models.data?.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {form.effort === "panel" && (
          <div>
            <label className={label} htmlFor="panel_size">
              Panel size
            </label>
            <input id="panel_size" type="number" min={2} className={field} value={form.panel_size} onChange={(e) => set("panel_size", Number(e.target.value))} />
          </div>
        )}
      </div>

      {create.error && <ErrorBox error={create.error} title="Could not start the run" />}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-xs text-brand hover:underline"
          onClick={() => setForm({ ...EMPTY, indication: "Alzheimer's disease", mechanism: "BACE1 inhibition" })}
        >
          Use the BACE1 example
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {create.isPending && <Spinner className="h-3 w-3" />}
          Underwrite
        </button>
      </div>
    </form>
  );
}
