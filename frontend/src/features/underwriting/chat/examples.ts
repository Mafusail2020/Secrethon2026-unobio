export interface Example {
  id: string;
  title: string;
  hint: string;
  indication: string;
  mechanism: string;
}

// hints are expectations about what a run may show, not conclusions
export const EXAMPLES: Example[] = [
  {
    id: "bace1-alzheimers",
    title: "BACE1 inhibition for Alzheimer's disease",
    hint: "Expected: late-stage failures",
    indication: "Alzheimer's disease",
    mechanism: "BACE1 inhibition",
  },
  {
    id: "pcsk9-hypercholesterolemia",
    title: "PCSK9 inhibition for hypercholesterolemia",
    hint: "Expected: strong human genetics",
    indication: "Hypercholesterolemia",
    mechanism: "PCSK9 inhibition",
  },
];
