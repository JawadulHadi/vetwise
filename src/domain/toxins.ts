import type { Species, ToxinCategory, Verdict } from './types.js';

/**
 * The curated toxicosis catalogue.
 *
 * Every record is deliberately data, not prose: the assessment engine does the
 * arithmetic, and the UI can show the exact threshold that moved the verdict.
 * Thresholds are per kilogram of body weight unless the record says otherwise.
 *
 * Sources were read on 2026-11-08. Quotes are short excerpts used as evidence;
 * they are not a substitute for the full article or for veterinary advice.
 */
export const SOURCES_ACCESSED = '2026-11-08';

export interface ToxinSource {
  publisher: string;
  title: string;
  url?: string;
  quote: string;
  accessed: string;
}

export interface DoseBand {
  /** Lower bound of the band, in the toxin's dose basis. */
  at: number;
  label: string;
  verdict: Verdict;
  detail?: string;
}

export interface ToxinProduct {
  id: string;
  label: string;
  aliases: string[];
  /** Milligrams of toxic principle per gram of product (chocolate, xylitol gum). */
  mgPerGram?: number;
  /** Milligrams of toxic principle per millilitre (coffee, liquid medicine). */
  mgPerMl?: number;
  /** Milligrams of toxic principle per tablet/capsule/piece. */
  mgPerPiece?: number;
  /**
   * Size of one piece: grams for a solid (chocolate bar, bread loaf, mothball)
   * or millilitres for a drink (one glass of wine, one shot).
   */
  gramsPerPiece?: number;
  /** Millilitres of ethanol per millilitre of drink. */
  gramsPerMl?: number;
  /** Product-specific verdict override, e.g. tea tree oil for cats. */
  verdict?: Verdict;
  note?: string;
}

export type DoseBasis = 'mg_per_kg' | 'g_per_kg' | 'ml_per_kg' | 'pieces_per_kg';

export interface Toxin {
  id: string;
  name: string;
  aliases: string[];
  category: ToxinCategory;
  /** Species with documented toxicity for this record. */
  species: Species[];
  summary: string;
  mechanism: string;
  basis: DoseBasis;
  /** Human-readable dose unit, e.g. `mg/kg`. */
  unitLabel: string;
  bands: DoseBand[];
  bandsBySpecies?: Partial<Record<Species, DoseBand[]>>;
  /** Verdict for any exposure when amount is unknown or below the first band. */
  anyAmountVerdict?: Verdict;
  anyAmountNote?: string;
  signs: string[];
  severeSigns?: string[];
  firstAid: string[];
  avoid: string[];
  products?: ToxinProduct[];
  defaultProductId?: string;
  sources: ToxinSource[];
  limitations?: string[];
  /** Set when the amount is not needed to reach a verdict. */
  amountOptional?: boolean;
}

const merck = (slug: string, title: string, quote: string): ToxinSource => ({
  publisher: 'Merck Veterinary Manual',
  title,
  url: `https://www.merckvetmanual.com/toxicology/${slug}`,
  quote,
  accessed: SOURCES_ACCESSED,
});

const pph = (slug: string, title: string, quote: string): ToxinSource => ({
  publisher: 'Pet Poison Helpline',
  title,
  url: `https://www.petpoisonhelpline.com/poison/${slug}/`,
  quote,
  accessed: SOURCES_ACCESSED,
});

const aspca = (title: string, quote: string, url = 'https://www.aspca.org/pet-care/animal-poison-control'): ToxinSource => ({
  publisher: 'ASPCA Animal Poison Control Center',
  title,
  url,
  quote,
  accessed: SOURCES_ACCESSED,
});

const CHOCOLATE_SOURCE = merck(
  'food-hazards/chocolate-toxicosis-in-animals',
  'Chocolate Toxicosis in Animals',
  'Methylxanthine concentrations vary by chocolate type: cocoa powder 28.5 mg/g, unsweetened (baker’s) chocolate 15.5 mg/g, semisweet and sweet dark chocolate 5.3–5.6 mg/g, milk chocolate 2.3 mg/g, and white chocolate 0.04 mg/g.',
);

const CHOCOLATE_BANDS = merck(
  'food-hazards/chocolate-toxicosis-in-animals',
  'Chocolate Toxicosis in Animals',
  'Mild clinical signs may occur in dogs ingesting 20 mg/kg; cardiotoxic effects occur after ingesting 40–50 mg/kg, and seizures occur after ingesting doses ≥ 60 mg/kg.',
);

const XYLITOL_SOURCE = merck(
  'food-hazards/xylitol-toxicosis-in-dogs',
  'Xylitol Toxicosis in Dogs',
  'Doses of xylitol greater than approximately 100 mg/kg have been associated with hypoglycemia in dogs. Some dogs ingesting xylitol at doses > 500 mg/kg may develop severe hepatic insufficiency or failure.',
);

const GRAPE_SOURCE = merck(
  'food-hazards/grape-raisin-and-tamarind-vitis-spp-tamarindus-spp-toxicosis-in-dogs',
  'Grape, Raisin, and Tamarind Toxicosis in Dogs',
  'In general, more than one grape or raisin per 4.5 kg (10 lb) of body weight may result in renal injury. Cases reported to date have been in dogs; anecdotal reports exist of renal failure in cats and ferrets after ingesting grapes or raisins.',
);

const ALLIUM_SOURCE = merck(
  'food-hazards/garlic-and-onion-allium-spp-toxicosis-in-animals',
  'Garlic and Onion (Allium spp) Toxicosis in Animals',
  'Toxicosis has been reported in cats after ingesting less than a teaspoon of cooked onions or 5 g/kg of raw onions. In dogs, ingestion of 15–30 g/kg of raw onion has resulted in clinical signs.',
);

const MACADAMIA_SOURCE = merck(
  'food-hazards/macadamia-nut-toxicosis-in-dogs',
  'Macadamia Nut Toxicosis in Dogs',
  'Dogs have developed clinical signs after ingesting macadamia nuts at 2.4 g/kg. Dogs experimentally dosed with commercially prepared macadamia nuts at 20 g/kg developed clinical signs within 12 hours and were clinically normal without treatment within 48 hours.',
);

const AVOCADO_SOURCE = merck(
  'food-hazards/avocado-persea-spp-toxicosis-in-animals',
  'Avocado (Persea spp) Toxicosis in Animals',
  'Persin is the toxic principle in avocado; dogs and cats can develop gastrointestinal upset, and birds and production animals are more severely affected.',
);

const BREAD_DOUGH_SOURCE = merck(
  'food-hazards/bread-dough-toxicosis-in-animals',
  'Bread Dough Toxicosis in Animals',
  'Ingested bread dough expands in the stomach and ferments, producing ethanol; both the physical distension and the alcohol can be dangerous.',
);

const ALCOHOL_SOURCE = merck(
  'toxicoses-from-household-hazards/toxicoses-from-alcohols-in-animals',
  'Toxicoses from Alcohols in Animals',
  'Ethanol toxicosis causes central nervous system depression, ataxia, vomiting, and hypoglycemia; young and small animals are at greater risk.',
);

const HOUSEHOLD_SOURCE = merck(
  'toxicoses-from-household-hazards/overview-of-household-hazard-toxicoses-in-animals',
  'Overview of Household Hazard Toxicoses in Animals',
  'Household cleaners, personal care products, and other common household substances can cause corrosive injury, aspiration, or systemic toxicity depending on the product and exposure.',
);

const ESSENTIAL_OIL_SOURCE = merck(
  'toxicoses-from-household-hazards/toxicoses-from-essential-oils-in-animals',
  'Toxicoses from Essential Oils in Animals',
  'Essential oils can cause gastrointestinal upset, central nervous system depression, and aspiration pneumonia; cats are especially vulnerable because of differences in hepatic metabolism.',
);

const MOTHBALL_SOURCE = merck(
  'toxicoses-from-household-hazards/toxicosis-from-mothballs-in-animals',
  'Toxicosis from Mothballs in Animals',
  'Mothballs contain naphthalene or paradichlorobenzene; ingestion can cause hemolysis, methemoglobinemia, gastrointestinal upset, and neurologic signs.',
);

const LILY_SOURCE = pph(
  'lilies',
  'Lilies Are Toxic to Cats',
  'Lilies are toxic to cats. Examples include Japanese Show, Western, and wood lilies. Even the pollen or water from a vase may result in severe kidney failure.',
);

const SAGO_SOURCE = pph(
  'sago-palm',
  'Sago Palm Is Toxic to Dogs',
  'Ingestion results in severe liver failure post-ingestion. Clinical signs include vomiting, diarrhea, and black-tarry stool.',
);

const AZALEA_SOURCE = pph(
  'azalea',
  'Azalea Is Toxic to Dogs',
  'Chewing into this plant releases grayanotoxins, which can cause drooling, vomiting, weakness, and abnormal heart rhythms.',
);

const TULIP_SOURCE = pph(
  'tulip',
  'Tulips and Hyacinths Are Toxic to Pets',
  'Typical signs include profuse drooling, vomiting, or even diarrhea, depending on the amount consumed; the bulb is the most toxic part.',
);

const POTHOS_SOURCE = pph(
  'philodendron',
  'Philodendron Are Toxic to Pets',
  'Chewing or biting into this plant releases insoluble calcium oxalate crystals, causing tissue penetration and irritation of the mouth and GI tract.',
);

const IBUPROFEN_SOURCE = pph(
  'ibuprofen',
  'Ibuprofen Is Toxic to Dogs',
  'Although ibuprofen is used commonly by people, dogs and cats are very sensitive to this drug and its use is not recommended.',
);

const ACETAMINOPHEN_SOURCE = pph(
  'acetaminophen',
  'Acetaminophen Is Toxic to Cats',
  'Cats have a decreased ability to metabolize acetaminophen in their liver, making them more susceptible to poisoning.',
);

const ASPIRIN_SOURCE = pph(
  'aspirin',
  'Aspirin Is Toxic to Dogs',
  'Aspirin can cause gastrointestinal ulceration and bleeding, and cats are more sensitive because they clear salicylates slowly.',
);

const SSRI_SOURCE = pph(
  'antidepressants',
  'Antidepressants Are Toxic to Dogs',
  'Antidepressants can cause agitation, vomiting, tremors, and serotonin syndrome; dogs and cats are both at risk.',
);

const PERMETHRIN_SOURCE = aspca(
  'Permethrin and pyrethroid insecticides',
  'Permethrin products labeled for dogs can be fatal to cats, even when the cat is only exposed to the treated dog or to a small amount of the product.',
);

const RODENTICIDE_SOURCE = aspca(
  'Rodenticides',
  'Rodenticide baits are designed to be eaten; depending on the active ingredient they can cause uncontrolled bleeding, brain swelling, or severe calcium imbalance. Any exposure is an emergency.',
);

const ETHYLENE_GLYCOL_SOURCE = pph(
  'antifreeze',
  'Antifreeze Is Toxic to Dogs',
  'Antifreeze containing ethylene glycol is extremely toxic; even a small amount can cause acute kidney failure, and treatment is most effective when started immediately.',
);

const MOTHBALL_SOURCE_PPH = pph(
  'mothballs',
  'Mothballs Are Toxic to Dogs',
  'Older mothballs most commonly contain naphthalene; ingestion can cause hemolysis and neurologic signs.',
);

const TEA_TREE_SOURCE = pph(
  'tea-tree-oil',
  'Tea Tree Oil Is Toxic to Dogs',
  'Clinical signs include a low body temperature, weakness, inability to walk, tremors, coma, increased liver enzymes, and death.',
);

const COCOA_BAR: ToxinProduct = {
  id: 'dark-65',
  label: '65% cocoa dark chocolate bar',
  aliases: ['65%', 'dark chocolate', 'dark', 'semisweet', 'bittersweet', 'cocoa bar'],
  mgPerGram: 10.1,
  gramsPerPiece: 100,
  note: 'A 65% cocoa bar contains about 10.1 mg methylxanthines per gram.',
};

export const TOXINS: Toxin[] = [
  {
    id: 'chocolate',
    name: 'Chocolate',
    aliases: ['chocolate', 'choc', 'cocoa', 'brownie', 'cookie', 'candy bar', 'dark chocolate', 'milk chocolate', 'white chocolate'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Chocolate contains theobromine and caffeine, methylxanthines that stimulate the heart and nervous system.',
    mechanism: 'Methylxanthines block adenosine receptors and increase intracellular calcium, producing tachycardia, tremors, and seizures.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg methylxanthines',
    bands: [
      { at: 0, label: 'Below the threshold for methylxanthine signs', verdict: 'monitor', detail: 'Vomiting or diarrhea from fat and sugar is still possible.' },
      { at: 20, label: 'Mild methylxanthine signs expected', verdict: 'call_vet', detail: 'Vomiting, diarrhea, restlessness, and a racing heart can begin around 20 mg/kg.' },
      { at: 40, label: 'Cardiotoxic range', verdict: 'emergency', detail: 'Cardiotoxic effects are reported at 40–50 mg/kg: arrhythmias, weakness, and collapse.' },
      { at: 60, label: 'Seizure range', verdict: 'emergency', detail: 'Seizures are reported at doses of 60 mg/kg and above.' },
    ],
    signs: ['vomiting', 'diarrhea', 'restlessness', 'racing heart', 'tremors', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: [
      'Move the chocolate out of reach and keep your pet calm.',
      'Do not induce vomiting unless a veterinarian or poison control tells you to.',
      'Call your veterinarian or ASPCA APCC with the product wrapper, your pet’s weight, and the amount eaten.',
    ],
    avoid: ['Do not give milk, salt water, or hydrogen peroxide to make your pet vomit.'],
    products: [
      { id: 'cocoa-powder', label: 'Cocoa powder', aliases: ['cocoa powder', 'baking cocoa'], mgPerGram: 28.5, gramsPerPiece: 5 },
      { id: 'bakers', label: 'Unsweetened baker’s chocolate', aliases: ['baker', 'baking chocolate', 'unsweetened chocolate'], mgPerGram: 15.5, gramsPerPiece: 28 },
      COCOA_BAR,
      { id: 'semisweet', label: 'Semisweet or sweet dark chocolate', aliases: ['semisweet', 'sweet dark', 'chocolate chips'], mgPerGram: 5.45, gramsPerPiece: 10 },
      { id: 'milk', label: 'Milk chocolate', aliases: ['milk chocolate', 'milk', 'candy bar'], mgPerGram: 2.3, gramsPerPiece: 43 },
      { id: 'white', label: 'White chocolate', aliases: ['white chocolate', 'white'], mgPerGram: 0.04, gramsPerPiece: 43 },
    ],
    defaultProductId: 'milk',
    sources: [CHOCOLATE_SOURCE, CHOCOLATE_BANDS],
    limitations: ['Methylxanthine content varies by brand and recipe. When the product is unknown, Vetwise will not guess.'],
  },
  {
    id: 'xylitol',
    name: 'Xylitol',
    aliases: ['xylitol', 'sugar-free gum', 'sugar free gum', 'sugar-free candy', 'sugar-free', 'birch sugar', 'gum', 'mints', 'toothpaste'],
    category: 'food',
    species: ['dog'],
    summary: 'Xylitol is a sugar alcohol that triggers a massive insulin release in dogs, then can injure the liver.',
    mechanism: 'Xylitol is rapidly absorbed and stimulates insulin secretion, causing hypoglycemia; high doses cause hepatic necrosis.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg xylitol',
    bands: [
      { at: 0, label: 'Below the hypoglycemia threshold', verdict: 'monitor', detail: 'Watch for vomiting and weakness; a small amount can still upset the stomach.' },
      { at: 100, label: 'Hypoglycemia threshold', verdict: 'call_vet', detail: 'Doses above about 100 mg/kg can cause life-threatening low blood sugar.' },
      { at: 500, label: 'Hepatic injury threshold', verdict: 'emergency', detail: 'Doses above 500 mg/kg can cause severe liver failure.' },
    ],
    signs: ['vomiting', 'weakness', 'lethargy', 'tremors', 'seizures', 'collapse'],
    severeSigns: ['seizure', 'collapse', 'tremors', 'difficulty_breathing'],
    firstAid: [
      'Remove the gum, mints, or baked good and keep the wrapper.',
      'Do not induce vomiting unless a veterinarian or poison control tells you to.',
      'Call your veterinarian or ASPCA APCC now; low blood sugar can develop within 30–60 minutes.',
    ],
    avoid: ['Never assume a “sugar-free” product is safe for a dog.'],
    products: [
      { id: 'gum', label: 'Sugar-free gum', aliases: ['gum', 'chewing gum', 'sugar-free gum'], mgPerPiece: 500, note: 'A typical piece contains about 0.5 g of xylitol.' },
      { id: 'mints', label: 'Sugar-free mints', aliases: ['mint', 'mints', 'breath mint'], mgPerPiece: 250 },
      { id: 'toothpaste', label: 'Xylitol toothpaste', aliases: ['toothpaste', 'dental chew'], mgPerGram: 250, gramsPerPiece: 5 },
      { id: 'peanut-butter', label: 'Xylitol-sweetened peanut butter', aliases: ['peanut butter', 'nut butter'], mgPerGram: 100, gramsPerPiece: 32 },
      { id: 'baked-good', label: 'Xylitol-sweetened baked good', aliases: ['brownie', 'cake', 'cookie'], mgPerGram: 100, gramsPerPiece: 60 },
    ],
    defaultProductId: 'gum',
    sources: [XYLITOL_SOURCE, pph('xylitol', 'Xylitol Is Toxic to Dogs', 'Xylitol is a natural, sugar-free sweetener. If enough is ingested it can cause life-threatening low blood sugar and liver failure.')],
    limitations: ['Cats do not have a documented xylitol toxicosis syndrome, but that does not make xylitol safe for them.'],
  },
  {
    id: 'grapes',
    name: 'Grapes and raisins',
    aliases: ['grape', 'grapes', 'raisin', 'raisins', 'sultana', 'sultanas', 'currant', 'currants', 'tamarind'],
    category: 'food',
    species: ['dog'],
    summary: 'Grapes, raisins, sultanas, and currants can cause acute kidney failure in dogs.',
    mechanism: 'The exact toxin is uncertain; tartaric acid and related compounds are proposed causes of proximal tubular injury.',
    basis: 'pieces_per_kg',
    unitLabel: 'grapes or raisins per kg',
    bands: [
      { at: 1 / 4.5, label: 'Above one grape or raisin per 4.5 kg', verdict: 'emergency', detail: 'This is the range associated with renal injury; any exposure still warrants a vet call.' },
    ],
    anyAmountVerdict: 'call_vet',
    amountOptional: true,
    anyAmountNote: 'There is no established safe amount of grapes or raisins for a dog. Any exposure warrants a call to your vet or poison control.',
    signs: ['vomiting', 'diarrhea', 'lethargy', 'not eating', 'increased thirst', 'decreased urine'],
    severeSigns: ['collapse', 'difficulty_breathing'],
    firstAid: [
      'Remove any remaining grapes or raisins.',
      'Do not induce vomiting unless a veterinarian or poison control tells you to.',
      'Call your veterinarian or ASPCA APCC immediately, even if your dog seems fine.',
    ],
    avoid: ['Do not wait for symptoms. Kidney injury can be silent at first.'],
    products: [
      { id: 'grape', label: 'Grapes', aliases: ['grape', 'grapes'], gramsPerPiece: 5 },
      { id: 'raisin', label: 'Raisins', aliases: ['raisin', 'raisins', 'sultana', 'currant'], gramsPerPiece: 1 },
    ],
    defaultProductId: 'grape',
    sources: [GRAPE_SOURCE, pph('grapes', 'Grapes Are Toxic to Dogs', 'Grapes, raisins, sultanas, and even currants are toxic to your dog. Ingestion of a small amount of grapes or raisins can result in severe, acute kidney failure.')],
    limitations: ['Cats have anecdotal reports of kidney injury but no published case series; Vetwise returns unverified for cats rather than reassurance.'],
  },
  {
    id: 'allium',
    name: 'Onion and garlic',
    aliases: ['onion', 'onions', 'garlic', 'garlic powder', 'onion powder', 'chives', 'leek', 'shallot', 'allium', 'soup mix'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Onions, garlic, chives, leeks, and shallots damage red blood cells and can cause hemolytic anemia.',
    mechanism: 'Organosulfur compounds oxidize hemoglobin, forming Heinz bodies and leading to red-cell destruction.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg onion or garlic',
    bands: [
      { at: 0, label: 'Below the reported toxic range', verdict: 'monitor', detail: 'GI upset is possible; concentrated powders are much more potent than fresh onion.' },
      { at: 5, label: 'Reported toxic range', verdict: 'call_vet', detail: 'Cats have shown toxicosis after about 5 g/kg of raw onion; dogs after 15–30 g/kg.' },
      { at: 15, label: 'Higher-dose range', verdict: 'emergency', detail: 'At this dose, anemia and Heinz-body hemolysis are a real concern.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Below the reported toxic range', verdict: 'monitor', detail: 'Cats are more sensitive than dogs; even small amounts can matter.' },
        { at: 1, label: 'Low-dose feline exposure', verdict: 'call_vet', detail: 'Toxicosis has been reported in cats after less than a teaspoon of cooked onions.' },
        { at: 5, label: 'Reported feline toxic range', verdict: 'emergency', detail: '5 g/kg of raw onion has caused toxicosis in cats.' },
      ],
      dog: [
        { at: 0, label: 'Below the reported toxic range', verdict: 'monitor', detail: 'GI upset is possible; concentrated powders are much more potent than fresh onion.' },
        { at: 15, label: 'Reported canine toxic range', verdict: 'call_vet', detail: 'Ingestion of 15–30 g/kg of raw onion has caused clinical signs in dogs.' },
        { at: 30, label: 'Higher-dose range', verdict: 'emergency', detail: 'At this dose, anemia and Heinz-body hemolysis are a real concern.' },
      ],
    },
    signs: ['vomiting', 'diarrhea', 'lethargy', 'pale gums', 'weakness', 'rapid breathing'],
    severeSigns: ['collapse', 'difficulty_breathing'],
    firstAid: [
      'Remove the food and keep the ingredient label.',
      'Do not induce vomiting unless a veterinarian or poison control tells you to.',
      'Call your veterinarian or ASPCA APCC; signs of anemia can be delayed by several days.',
    ],
    avoid: ['Do not feed table scraps, soup mixes, or seasoned food without checking the ingredients.'],
    products: [
      { id: 'onion', label: 'Onion', aliases: ['onion', 'onions'], gramsPerPiece: 150 },
      { id: 'garlic', label: 'Garlic', aliases: ['garlic', 'clove'], gramsPerPiece: 3 },
      { id: 'powder', label: 'Onion or garlic powder', aliases: ['powder', 'soup mix'], gramsPerPiece: 2 },
    ],
    defaultProductId: 'onion',
    sources: [ALLIUM_SOURCE, pph('onion', 'Onions Are Toxic to Dogs', 'Toxic doses of onion and garlic can cause oxidative damage to the red blood cells and gastroenteritis. Poisoning may have a delayed onset.')],
  },
  {
    id: 'macadamia',
    name: 'Macadamia nuts',
    aliases: ['macadamia', 'macadamia nut', 'macadamia nuts', 'nut', 'nuts', 'cookie'],
    category: 'food',
    species: ['dog'],
    summary: 'Macadamia nuts cause weakness, tremors, and hyperthermia in dogs; the mechanism is unknown.',
    mechanism: 'The toxic principle has not been identified; signs are self-limited in most cases.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg macadamia nuts',
    bands: [
      { at: 0, label: 'Below the reported range', verdict: 'monitor', detail: 'Rich, fatty nuts can still cause vomiting or diarrhea.' },
      { at: 2, label: 'Reported sign range', verdict: 'call_vet', detail: 'Dogs have developed signs after about 2.4 g/kg.' },
      { at: 20, label: 'High-dose range', verdict: 'call_vet', detail: 'Experimental dogs at 20 g/kg developed signs but recovered with supportive care.' },
    ],
    signs: ['weakness', 'lethargy', 'vomiting', 'tremors', 'joint stiffness', 'increased body temperature'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing'],
    firstAid: ['Remove the nuts.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC for advice.'],
    avoid: ['Do not give macadamia nuts as a treat, and keep nut mixes off counters.'],
    products: [
      { id: 'nut', label: 'Macadamia nut', aliases: ['nut', 'nuts'], gramsPerPiece: 2.5 },
      { id: 'cookie', label: 'Macadamia cookie', aliases: ['cookie', 'biscuit'], gramsPerPiece: 15 },
    ],
    defaultProductId: 'nut',
    sources: [MACADAMIA_SOURCE, pph('macadamia-nuts', 'Macadamia Nuts Are Toxic to Dogs', 'Depending on the amount ingested, clinical signs include lethargy, increased body temperature, vomiting, tremors, and joint stiffness.')],
    limitations: ['Cats are not a documented macadamia toxicosis species; Vetwise returns unverified for cats.'],
  },
  {
    id: 'avocado',
    name: 'Avocado',
    aliases: ['avocado', 'guacamole', 'persin'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Avocado contains persin, which can cause gastrointestinal upset; the pit can also obstruct the gut.',
    mechanism: 'Persin is a fungicidal toxin that damages myocardial and skeletal muscle in susceptible species; dogs and cats are less sensitive than birds or rabbits.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg avocado',
    bands: [
      { at: 0, label: 'Low concern for a small taste', verdict: 'monitor', detail: 'Watch for vomiting or diarrhea; the pit is a choking and obstruction risk.' },
      { at: 10, label: 'Larger ingestion', verdict: 'call_vet', detail: 'A large amount can cause significant GI upset, and the pit is a surgical risk.' },
    ],
    anyAmountVerdict: 'monitor',
    signs: ['vomiting', 'diarrhea', 'lethargy', 'abdominal pain'],
    severeSigns: ['collapse', 'difficulty_breathing'],
    firstAid: ['Remove the avocado and the pit.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian if your pet vomits repeatedly or seems uncomfortable.'],
    avoid: ['Do not let your pet chew on the pit.'],
    products: [
      { id: 'flesh', label: 'Avocado flesh', aliases: ['avocado', 'guacamole'], gramsPerPiece: 150 },
      { id: 'pit', label: 'Avocado pit', aliases: ['pit', 'stone'], gramsPerPiece: 45, verdict: 'call_vet', note: 'The pit is a foreign-body obstruction risk even though it is not more toxic.' },
    ],
    defaultProductId: 'flesh',
    sources: [AVOCADO_SOURCE, pph('avocado', 'Avocado Is Toxic to Dogs', 'Avocado contains persin. The fruit can cause gastrointestinal upset, and the large pit can cause obstruction.')],
  },
  {
    id: 'bread-dough',
    name: 'Bread dough',
    aliases: ['bread dough', 'dough', 'yeast dough', 'rising dough', 'bread'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Raw yeast dough expands in the stomach and ferments into ethanol, causing bloating and alcohol toxicity.',
    mechanism: 'Yeast fermentation produces carbon dioxide and ethanol; the expanding mass can twist or rupture the stomach.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg dough',
    bands: [
      { at: 0, label: 'Small amount', verdict: 'monitor', detail: 'Watch for bloating, vomiting, and wobbliness.' },
      { at: 5, label: 'Significant dough ingestion', verdict: 'call_vet', detail: 'Expansion and ethanol production become a real concern.' },
      { at: 20, label: 'Large dough ingestion', verdict: 'emergency', detail: 'Gastric distension and alcohol toxicosis can be life-threatening.' },
    ],
    signs: ['bloating', 'vomiting', 'retching', 'lethargy', 'wobbliness', 'collapse'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure'],
    firstAid: ['Keep your pet away from the dough and do not let them drink more.', 'Do not induce vomiting; the expanding dough can be dangerous.', 'Call your veterinarian or ASPCA APCC immediately.'],
    avoid: ['Do not leave dough to rise where a pet can reach it.'],
    products: [
      { id: 'dough', label: 'Bread dough', aliases: ['dough', 'yeast dough'], gramsPerPiece: 500 },
      { id: 'roll', label: 'Dinner roll dough', aliases: ['roll', 'bun'], gramsPerPiece: 60 },
    ],
    defaultProductId: 'dough',
    sources: [BREAD_DOUGH_SOURCE, pph('bread-dough', 'Bread Dough Is Toxic to Dogs', 'When pets ingest rising bread dough, alcohol from the fermenting yeast in the dough is rapidly absorbed into the bloodstream.')],
  },
  {
    id: 'alcohol',
    name: 'Alcohol (ethanol)',
    aliases: ['alcohol', 'ethanol', 'beer', 'wine', 'vodka', 'whiskey', 'liquor', 'hand sanitizer', 'mouthwash', 'rum', 'gin'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Ethanol depresses the central nervous system and can cause dangerous low blood sugar, especially in small pets.',
    mechanism: 'Ethanol is metabolized to acetaldehyde and competes with glucose production, causing CNS depression and hypoglycemia.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg ethanol',
    bands: [
      { at: 0, label: 'Low-dose exposure', verdict: 'monitor', detail: 'Watch for wobbliness, vomiting, and sleepiness.' },
      { at: 0.5, label: 'Significant ethanol dose', verdict: 'call_vet', detail: 'Ataxia, vomiting, and sedation are expected.' },
      { at: 3, label: 'Severe ethanol dose', verdict: 'emergency', detail: 'Seizures, coma, and respiratory depression are possible.' },
    ],
    signs: ['wobbliness', 'vomiting', 'lethargy', 'drooling', 'low body temperature', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing'],
    firstAid: ['Remove the drink or product.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC; keep your pet warm and do not leave them alone.'],
    avoid: ['Do not leave drinks, hand sanitizer, or mouthwash within reach.'],
    products: [
      { id: 'beer', label: 'Beer (about 5% alcohol)', aliases: ['beer', 'lager', 'ale'], gramsPerMl: 0.039, gramsPerPiece: 14 },
      { id: 'wine', label: 'Wine (about 12% alcohol)', aliases: ['wine', 'prosecco', 'champagne'], gramsPerMl: 0.095, gramsPerPiece: 14 },
      { id: 'spirit', label: 'Spirit (about 40% alcohol)', aliases: ['vodka', 'whiskey', 'rum', 'gin', 'liquor', 'shot'], gramsPerMl: 0.316, gramsPerPiece: 14 },
      { id: 'sanitizer', label: 'Hand sanitizer (about 62% alcohol)', aliases: ['hand sanitizer', 'sanitizer', 'purell'], gramsPerMl: 0.62, gramsPerPiece: 1 },
      { id: 'mouthwash', label: 'Mouthwash (about 20% alcohol)', aliases: ['mouthwash', 'listerine'], gramsPerMl: 0.2, gramsPerPiece: 20 },
    ],
    defaultProductId: 'beer',
    sources: [ALCOHOL_SOURCE, pph('alcohol', 'Alcohol Is Toxic to Pets', 'Alcohol is rapidly absorbed and can cause vomiting, wobbliness, low blood sugar, seizures, and respiratory depression.')],
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    aliases: ['caffeine', 'coffee', 'espresso', 'tea', 'energy drink', 'soda', 'caffeine pill', 'pre-workout'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'Caffeine is a methylxanthine that speeds the heart and nervous system; pets are much more sensitive than people.',
    mechanism: 'Caffeine blocks adenosine receptors and raises intracellular calcium, causing tachycardia, tremors, and seizures.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg caffeine',
    bands: [
      { at: 0, label: 'Below the threshold for caffeine signs', verdict: 'monitor', detail: 'GI upset is possible; keep an eye on your pet.' },
      { at: 15, label: 'Mild caffeine signs expected', verdict: 'call_vet', detail: 'Restlessness, vomiting, and a racing heart can begin around this dose.' },
      { at: 40, label: 'Severe caffeine dose', verdict: 'emergency', detail: 'Tremors, arrhythmias, and seizures are possible.' },
      { at: 80, label: 'Seizure range', verdict: 'emergency', detail: 'Seizures and cardiovascular collapse are likely.' },
    ],
    signs: ['restlessness', 'vomiting', 'racing heart', 'tremors', 'seizures', 'collapse'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Remove the coffee, tea, or energy drink.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not share coffee, tea, or energy drinks with pets.'],
    products: [
      { id: 'coffee', label: 'Brewed coffee', aliases: ['coffee', 'brew'], mgPerMl: 0.4, gramsPerPiece: 240 },
      { id: 'espresso', label: 'Espresso', aliases: ['espresso', 'shot'], mgPerMl: 2.1, gramsPerPiece: 30 },
      { id: 'tea', label: 'Tea', aliases: ['tea', 'chai'], mgPerMl: 0.2, gramsPerPiece: 240 },
      { id: 'soda', label: 'Cola or soda', aliases: ['soda', 'cola', 'coke'], mgPerMl: 0.1, gramsPerPiece: 355 },
      { id: 'energy', label: 'Energy drink', aliases: ['energy drink', 'monster', 'red bull'], mgPerMl: 0.32, gramsPerPiece: 250 },
      { id: 'pill', label: 'Caffeine tablet', aliases: ['caffeine pill', 'pre-workout', 'tablet'], mgPerPiece: 200 },
    ],
    defaultProductId: 'coffee',
    sources: [merck('food-hazards/chocolate-toxicosis-in-animals', 'Chocolate Toxicosis in Animals', 'Caffeine and theobromine are methylxanthines; the oral LD50 in dogs is reportedly 100–200 mg/kg, but severe signs can occur at much lower doses.'), pph('caffeine', 'Caffeine Is Toxic to Pets', 'Caffeine can cause agitation, vomiting, tremors, and cardiovascular effects in pets.')],
  },
  {
    id: 'salt',
    name: 'Salt (sodium chloride)',
    aliases: ['salt', 'table salt', 'sea salt', 'salted', 'pretzels', 'play dough', 'playdough', 'de-icer'],
    category: 'food',
    species: ['dog', 'cat'],
    summary: 'A large salt load can cause vomiting, dehydration, tremors, and brain swelling.',
    mechanism: 'Hypernatremia pulls water out of cells, causing neurologic dysfunction; rapid correction is also dangerous.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg salt',
    bands: [
      { at: 0, label: 'Below the toxic range', verdict: 'monitor', detail: 'Offer water and watch for vomiting.' },
      { at: 2, label: 'Significant salt dose', verdict: 'call_vet', detail: 'Vomiting, thirst, and dehydration are expected.' },
      { at: 4, label: 'Severe salt dose', verdict: 'emergency', detail: 'Tremors, seizures, and brain swelling are possible.' },
    ],
    signs: ['vomiting', 'diarrhea', 'excessive thirst', 'lethargy', 'tremors', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Remove the salt source and give small sips of fresh water.', 'Do not force large amounts of water.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Never use salt water to induce vomiting.'],
    products: [
      { id: 'salt', label: 'Table salt', aliases: ['salt', 'table salt', 'sea salt'], gramsPerPiece: 5 },
      { id: 'pretzel', label: 'Salted pretzels', aliases: ['pretzel', 'pretzels', 'chips'], gramsPerPiece: 2 },
      { id: 'playdough', label: 'Play dough', aliases: ['play dough', 'playdough'], gramsPerPiece: 100 },
    ],
    defaultProductId: 'salt',
    sources: [pph('salt', 'Salt Is Toxic to Pets', 'The use of salt to induce vomiting in dogs and cats is no longer recommended for use by pet owners or veterinarians.')],
  },
  {
    id: 'lily',
    name: 'True lily (Lilium spp.)',
    aliases: ['lily', 'lilies', 'lilium', 'tiger lily', 'asiatic lily', 'easter lily', 'stargazer', 'pollen', 'vase water'],
    category: 'plant',
    species: ['cat'],
    summary: 'True lilies are severely toxic to cats: even pollen, a leaf, or the vase water can cause kidney failure.',
    mechanism: 'The toxin is not fully identified; it causes acute proximal tubular necrosis in cats.',
    basis: 'g_per_kg',
    unitLabel: 'exposure',
    bands: [],
    anyAmountVerdict: 'emergency',
    amountOptional: true,
    anyAmountNote: 'Any exposure to a true lily — including pollen groomed off a paw or water from the vase — is an emergency for a cat.',
    signs: ['drooling', 'vomiting', 'lethargy', 'not eating', 'increased thirst', 'decreased urine'],
    severeSigns: ['collapse', 'difficulty_breathing'],
    firstAid: [
      'Move the cat away from the plant and wash any pollen off the coat and paws with a damp cloth.',
      'Do not wait for symptoms.',
      'Call your veterinarian or ASPCA APCC now; kidney injury can begin within hours.',
    ],
    avoid: ['Do not keep true lilies in a house with cats, even as cut flowers.'],
    sources: [LILY_SOURCE, aspca('Toxic and Non-Toxic Plants', 'True lilies (Lilium spp.) are highly toxic to cats; ingestion of any part, including pollen, can cause kidney failure.', 'https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants')],
    limitations: ['Lilium toxicity is documented in cats. For dogs, Vetwise returns unverified rather than calling it safe.'],
  },
  {
    id: 'sago-palm',
    name: 'Sago palm (Cycas revoluta)',
    aliases: ['sago', 'sago palm', 'cycad', 'cycas', 'palm'],
    category: 'plant',
    species: ['dog', 'cat'],
    summary: 'Sago palm seeds and leaves contain cycasin, which can cause severe liver failure.',
    mechanism: 'Cycasin is metabolized to methylazoxymethanol, a hepatotoxin and carcinogen.',
    basis: 'g_per_kg',
    unitLabel: 'exposure',
    bands: [],
    anyAmountVerdict: 'emergency',
    amountOptional: true,
    anyAmountNote: 'Any ingestion of sago palm is an emergency; the seeds are the most toxic part.',
    signs: ['vomiting', 'diarrhea', 'black tarry stool', 'lethargy', 'yellow gums', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing'],
    firstAid: ['Remove your pet from the plant.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC immediately.'],
    avoid: ['Do not keep sago palms where pets can reach them.'],
    sources: [SAGO_SOURCE, aspca('Toxic and Non-Toxic Plants', 'Sago palm is highly toxic to dogs and cats; ingestion can cause severe liver failure.', 'https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants')],
  },
  {
    id: 'azalea',
    name: 'Azalea and rhododendron',
    aliases: ['azalea', 'rhododendron', 'grayanotoxin', 'mountain laurel'],
    category: 'plant',
    species: ['dog', 'cat'],
    summary: 'Azaleas contain grayanotoxins that disrupt heart rhythm and cause drooling, vomiting, and weakness.',
    mechanism: 'Grayanotoxins bind sodium channels and prolong depolarization, producing bradycardia and arrhythmias.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg plant material',
    bands: [
      { at: 0, label: 'Any plant ingestion', verdict: 'call_vet', detail: 'Chewing the plant can cause oral irritation and GI signs.' },
      { at: 5, label: 'Significant plant ingestion', verdict: 'emergency', detail: 'At this amount, heart-rhythm effects and collapse are a concern.' },
    ],
    anyAmountVerdict: 'call_vet',
    signs: ['drooling', 'vomiting', 'weakness', 'abnormal heart rhythm', 'collapse', 'seizures'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure'],
    firstAid: ['Move your pet away from the plant.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not bring azalea or rhododendron trimmings indoors.'],
    products: [
      { id: 'leaf', label: 'Leaves or flowers', aliases: ['leaf', 'flower', 'leaves'], gramsPerPiece: 1 },
      { id: 'branch', label: 'Branch or trimming', aliases: ['branch', 'trimming'], gramsPerPiece: 20 },
    ],
    defaultProductId: 'leaf',
    sources: [AZALEA_SOURCE, aspca('Toxic and Non-Toxic Plants', 'Azaleas contain grayanotoxins and can cause vomiting, drooling, weakness, and cardiac arrhythmias in pets.', 'https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants')],
  },
  {
    id: 'tulip',
    name: 'Tulip and daffodil bulbs',
    aliases: ['tulip', 'tulips', 'daffodil', 'narcissus', 'hyacinth', 'bulb', 'flower bulb'],
    category: 'plant',
    species: ['dog', 'cat'],
    summary: 'Tulip, daffodil, and hyacinth bulbs contain irritating and cardiotoxic alkaloids; the bulb is the most dangerous part.',
    mechanism: 'Tulipalin and related alkaloids cause GI irritation; narcissus alkaloids can cause vomiting, tremors, and arrhythmias.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg bulb',
    bands: [
      { at: 0, label: 'Any bulb or flower ingestion', verdict: 'call_vet', detail: 'Drooling, vomiting, and diarrhea are common.' },
      { at: 2, label: 'Significant bulb ingestion', verdict: 'emergency', detail: 'Tremors, heart-rhythm effects, and collapse are possible.' },
    ],
    anyAmountVerdict: 'call_vet',
    signs: ['drooling', 'vomiting', 'diarrhea', 'lethargy', 'tremors', 'abnormal heart rhythm'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure', 'tremors'],
    firstAid: ['Remove the bulb or flower and rinse the mouth with water.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not leave bulbs out while planting, and keep cut flowers off low tables.'],
    products: [
      { id: 'bulb', label: 'Flower bulb', aliases: ['bulb', 'tulip bulb', 'daffodil bulb'], gramsPerPiece: 20 },
      { id: 'flower', label: 'Flower or stem', aliases: ['flower', 'stem', 'petal'], gramsPerPiece: 5 },
    ],
    defaultProductId: 'bulb',
    sources: [TULIP_SOURCE, pph('daffodil', 'Daffodils Are Toxic to Pets', 'Daffodil bulbs and flowers contain lycorine and other alkaloids that can cause vomiting, drooling, and tremors.')],
  },
  {
    id: 'pothos',
    name: 'Pothos and philodendron',
    aliases: ['pothos', 'philodendron', 'devil’s ivy', 'devils ivy', 'monstera', 'dieffenbachia'],
    category: 'plant',
    species: ['dog', 'cat'],
    summary: 'Pothos and philodendron contain insoluble calcium oxalate crystals that irritate the mouth and GI tract.',
    mechanism: 'Raphides penetrate oral tissue, causing pain, swelling, and drooling; severe swelling is uncommon but possible.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg plant material',
    bands: [
      { at: 0, label: 'Mouth irritation likely', verdict: 'monitor', detail: 'Drooling, pawing at the mouth, and vomiting are common and usually mild.' },
      { at: 10, label: 'Large plant ingestion', verdict: 'call_vet', detail: 'Significant oral swelling or GI upset warrants a vet call.' },
    ],
    anyAmountVerdict: 'monitor',
    signs: ['drooling', 'pawing at mouth', 'vomiting', 'oral pain', 'difficulty swallowing'],
    severeSigns: ['difficulty_breathing', 'collapse'],
    firstAid: ['Rinse the mouth with water and offer a small drink.', 'Do not induce vomiting.', 'Call your veterinarian if the mouth is swollen, your pet is struggling to breathe, or vomiting continues.'],
    avoid: ['Do not let pets chew on houseplant leaves or stems.'],
    products: [
      { id: 'leaf', label: 'Leaf', aliases: ['leaf', 'leaves'], gramsPerPiece: 3 },
      { id: 'stem', label: 'Stem', aliases: ['stem', 'vine'], gramsPerPiece: 10 },
    ],
    defaultProductId: 'leaf',
    sources: [POTHOS_SOURCE, aspca('Toxic and Non-Toxic Plants', 'Pothos and philodendron contain insoluble calcium oxalate crystals that cause oral irritation, drooling, and vomiting.', 'https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants')],
  },
  {
    id: 'ibuprofen',
    name: 'Ibuprofen',
    aliases: ['ibuprofen', 'advil', 'motrin', 'nurofen', 'nsaid', 'pain reliever', 'human painkiller'],
    category: 'human_medication',
    species: ['dog', 'cat'],
    summary: 'Ibuprofen is an NSAID that can cause stomach ulcers and kidney failure in dogs and cats.',
    mechanism: 'COX inhibition reduces protective prostaglandins in the stomach and kidney, causing GI ulceration and renal ischemia.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg ibuprofen',
    bands: [
      { at: 0, label: 'Below the reported canine GI threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or black stool.' },
      { at: 50, label: 'Canine GI toxicity range', verdict: 'call_vet', detail: 'Gastrointestinal ulceration can occur at about 50 mg/kg in dogs.' },
      { at: 100, label: 'Canine kidney-injury range', verdict: 'emergency', detail: 'Acute kidney injury is reported at about 100 mg/kg.' },
      { at: 200, label: 'Canine neurologic range', verdict: 'emergency', detail: 'Seizures and coma are possible at about 200 mg/kg.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Any feline exposure', verdict: 'call_vet', detail: 'Cats are very sensitive to NSAIDs; there is no home dose.' },
        { at: 5, label: 'Feline toxicity range', verdict: 'emergency', detail: 'Cats can develop kidney injury and GI ulceration at low doses.' },
        { at: 20, label: 'Severe feline dose', verdict: 'emergency', detail: 'Seizures and acute kidney injury are possible.' },
      ],
      dog: [
        { at: 0, label: 'Below the reported canine GI threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or black stool.' },
        { at: 50, label: 'Canine GI toxicity range', verdict: 'call_vet', detail: 'Gastrointestinal ulceration can occur at about 50 mg/kg in dogs.' },
        { at: 100, label: 'Canine kidney-injury range', verdict: 'emergency', detail: 'Acute kidney injury is reported at about 100 mg/kg.' },
        { at: 200, label: 'Canine neurologic range', verdict: 'emergency', detail: 'Seizures and coma are possible at about 200 mg/kg.' },
      ],
    },
    signs: ['vomiting', 'black stool', 'abdominal pain', 'lethargy', 'not eating', 'decreased urine'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure'],
    firstAid: ['Do not give any more. Keep the bottle and note the strength.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC before giving anything for pain.'],
    avoid: ['Never give human ibuprofen to a pet, and never combine it with another NSAID.'],
    products: [
      { id: '200', label: '200 mg tablet', aliases: ['200 mg', 'tablet'], mgPerPiece: 200 },
      { id: '400', label: '400 mg tablet', aliases: ['400 mg'], mgPerPiece: 400 },
      { id: '600', label: '600 mg tablet', aliases: ['600 mg'], mgPerPiece: 600 },
      { id: 'liquid', label: 'Children’s liquid (100 mg/5 ml)', aliases: ['liquid', 'suspension', 'syrup'], mgPerMl: 20 },
    ],
    defaultProductId: '200',
    sources: [IBUPROFEN_SOURCE, aspca('People Foods to Avoid Feeding Your Pets', 'Human medications such as ibuprofen are not formulated for pets and can cause serious harm.', 'https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets')],
    limitations: ['Vetwise never recommends a human medication for a pet, even at a calculated low dose.'],
  },
  {
    id: 'acetaminophen',
    name: 'Acetaminophen',
    aliases: ['acetaminophen', 'paracetamol', 'tylenol', 'panadol', 'apap', 'fever reducer'],
    category: 'human_medication',
    species: ['dog', 'cat'],
    summary: 'Acetaminophen can damage the liver and red blood cells; cats are especially vulnerable.',
    mechanism: 'Acetaminophen is metabolized to a reactive intermediate that depletes glutathione and oxidizes hemoglobin to methemoglobin.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg acetaminophen',
    bands: [
      { at: 0, label: 'Below the reported canine threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or lethargy.' },
      { at: 75, label: 'Canine toxicity range', verdict: 'call_vet', detail: 'Liver injury and methemoglobinemia are reported in this range.' },
      { at: 150, label: 'Severe canine dose', verdict: 'emergency', detail: 'Severe liver injury and hemolysis are possible.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Any feline exposure', verdict: 'call_vet', detail: 'Cats have a decreased ability to metabolize acetaminophen; there is no home dose.' },
        { at: 10, label: 'Feline toxicity range', verdict: 'emergency', detail: 'Methemoglobinemia and liver injury can occur at low doses.' },
        { at: 20, label: 'Severe feline dose', verdict: 'emergency', detail: 'Facial swelling, brown gums, and collapse are possible.' },
      ],
      dog: [
        { at: 0, label: 'Below the reported canine threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or lethargy.' },
        { at: 75, label: 'Canine toxicity range', verdict: 'call_vet', detail: 'Liver injury and methemoglobinemia are reported in this range.' },
        { at: 150, label: 'Severe canine dose', verdict: 'emergency', detail: 'Severe liver injury and hemolysis are possible.' },
      ],
    },
    signs: ['vomiting', 'lethargy', 'brown or blue gums', 'difficulty breathing', 'swelling', 'collapse'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure'],
    firstAid: ['Do not give any more. Keep the bottle and note the strength.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC immediately; cats can deteriorate quickly.'],
    avoid: ['Never give acetaminophen to a cat, and never give it to a dog without a veterinarian’s direction.'],
    products: [
      { id: '500', label: '500 mg tablet', aliases: ['500 mg', 'tablet', 'extra strength'], mgPerPiece: 500 },
      { id: '325', label: '325 mg tablet', aliases: ['325 mg', 'regular strength'], mgPerPiece: 325 },
      { id: 'liquid', label: 'Children’s liquid (160 mg/5 ml)', aliases: ['liquid', 'suspension', 'syrup'], mgPerMl: 32 },
    ],
    defaultProductId: '500',
    sources: [ACETAMINOPHEN_SOURCE, aspca('People Foods to Avoid Feeding Your Pets', 'Never give human medications such as acetaminophen to a pet without veterinary direction.', 'https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets')],
    limitations: ['Vetwise does not calculate or recommend a therapeutic acetaminophen dose for any pet.'],
  },
  {
    id: 'aspirin',
    name: 'Aspirin',
    aliases: ['aspirin', 'acetylsalicylic acid', 'asa', 'bayer', 'salicylate', 'bufferin'],
    category: 'human_medication',
    species: ['dog', 'cat'],
    summary: 'Aspirin can cause stomach ulcers and bleeding; cats clear salicylates slowly and are at high risk.',
    mechanism: 'Irreversible COX inhibition reduces gastric protection and platelet function; salicylate accumulates in cats.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg aspirin',
    bands: [
      { at: 0, label: 'Below the reported canine threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or black stool.' },
      { at: 25, label: 'Canine GI toxicity range', verdict: 'call_vet', detail: 'Gastric ulceration and bleeding are possible.' },
      { at: 50, label: 'Severe canine dose', verdict: 'emergency', detail: 'Significant bleeding and metabolic effects are possible.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Any feline exposure', verdict: 'call_vet', detail: 'Cats clear salicylates very slowly; there is no home dose.' },
        { at: 5, label: 'Feline toxicity range', verdict: 'call_vet', detail: 'Vomiting, depression, and bleeding are possible at low doses.' },
        { at: 20, label: 'Severe feline dose', verdict: 'emergency', detail: 'Seizures and severe bleeding are possible.' },
      ],
      dog: [
        { at: 0, label: 'Below the reported canine threshold', verdict: 'monitor', detail: 'Do not give more; watch for vomiting or black stool.' },
        { at: 25, label: 'Canine GI toxicity range', verdict: 'call_vet', detail: 'Gastric ulceration and bleeding are possible.' },
        { at: 50, label: 'Severe canine dose', verdict: 'emergency', detail: 'Significant bleeding and metabolic effects are possible.' },
      ],
    },
    signs: ['vomiting', 'black stool', 'abdominal pain', 'lethargy', 'bleeding', 'difficulty breathing'],
    severeSigns: ['collapse', 'difficulty_breathing', 'seizure'],
    firstAid: ['Do not give any more. Keep the bottle and note the strength.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Never give aspirin to a cat, and never give it to a dog without a veterinarian’s direction.'],
    products: [
      { id: '325', label: '325 mg tablet', aliases: ['325 mg', 'tablet', 'regular strength'], mgPerPiece: 325 },
      { id: '81', label: '81 mg low-dose tablet', aliases: ['81 mg', 'baby aspirin', 'low dose'], mgPerPiece: 81 },
      { id: '500', label: '500 mg tablet', aliases: ['500 mg', 'extra strength'], mgPerPiece: 500 },
    ],
    defaultProductId: '325',
    sources: [ASPIRIN_SOURCE, aspca('People Foods to Avoid Feeding Your Pets', 'Keep all human medications, including aspirin, out of reach of pets.', 'https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets')],
    limitations: ['Vetwise does not recommend aspirin for pets; some veterinarians use it only under direct supervision.'],
  },
  {
    id: 'ssri',
    name: 'Antidepressants (SSRIs and SNRIs)',
    aliases: ['ssri', 'snri', 'antidepressant', 'sertraline', 'zoloft', 'fluoxetine', 'prozac', 'escitalopram', 'lexapro', 'citalopram', 'celexa', 'paroxetine', 'paxil', 'venlafaxine', 'effexor', 'duloxetine', 'cymbalta'],
    category: 'human_medication',
    species: ['dog', 'cat'],
    summary: 'Antidepressants can cause agitation, vomiting, tremors, and serotonin syndrome in pets.',
    mechanism: 'Increased synaptic serotonin and norepinephrine produce CNS and autonomic hyperactivity.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg antidepressant',
    bands: [
      { at: 0, label: 'Below the reported threshold', verdict: 'monitor', detail: 'Watch for vomiting, sleepiness, or restlessness.' },
      { at: 5, label: 'Reported toxicity range', verdict: 'call_vet', detail: 'Agitation, tremors, and serotonin syndrome are possible.' },
      { at: 20, label: 'Severe dose', verdict: 'emergency', detail: 'Seizures, hyperthermia, and cardiovascular collapse are possible.' },
    ],
    signs: ['agitation', 'vomiting', 'drooling', 'tremors', 'rapid heart rate', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Remove the medication and keep the bottle.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not leave human antidepressants on a nightstand or in an open bag.'],
    products: [
      { id: '20', label: '20 mg tablet', aliases: ['20 mg', 'tablet'], mgPerPiece: 20 },
      { id: '50', label: '50 mg tablet', aliases: ['50 mg'], mgPerPiece: 50 },
      { id: '100', label: '100 mg tablet', aliases: ['100 mg'], mgPerPiece: 100 },
    ],
    defaultProductId: '20',
    sources: [SSRI_SOURCE, aspca('People Foods to Avoid Feeding Your Pets', 'Human antidepressants are a common cause of pet poisonings; keep all medications out of reach.', 'https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets')],
  },
  {
    id: 'permethrin',
    name: 'Permethrin flea products',
    aliases: ['permethrin', 'pyrethrin', 'pyrethroid', 'flea treatment', 'flea medicine', 'spot-on', 'flea collar', 'flea dip', 'insecticide'],
    category: 'pesticide',
    species: ['dog', 'cat'],
    summary: 'Permethrin is highly toxic to cats, including exposure from a dog’s spot-on product or a treated blanket.',
    mechanism: 'Pyrethroids keep sodium channels open, causing tremors, hyperthermia, and seizures; cats clear them slowly.',
    basis: 'mg_per_kg',
    unitLabel: 'mg/kg permethrin',
    bands: [
      { at: 0, label: 'Any feline exposure', verdict: 'emergency', detail: 'Cats can develop severe tremors and seizures from small amounts, including grooming a treated dog.' },
      { at: 20, label: 'Canine toxicity range', verdict: 'call_vet', detail: 'Dogs can develop tremors and hypersalivation at this dose.' },
      { at: 100, label: 'Severe canine dose', verdict: 'emergency', detail: 'Seizures and hyperthermia are possible.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Any feline exposure', verdict: 'emergency', detail: 'Permethrin products labeled for dogs can be fatal to cats.' },
      ],
      dog: [
        { at: 0, label: 'Any exposure', verdict: 'call_vet', detail: 'Keep the product away and call your vet for advice.' },
        { at: 20, label: 'Canine toxicity range', verdict: 'call_vet', detail: 'Tremors and hypersalivation are possible.' },
        { at: 100, label: 'Severe canine dose', verdict: 'emergency', detail: 'Seizures and hyperthermia are possible.' },
      ],
    },
    anyAmountVerdict: 'call_vet',
    signs: ['drooling', 'tremors', 'wobbliness', 'vomiting', 'seizures', 'increased body temperature'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Move the cat away from the treated animal or product.', 'If product is on the skin, wash with lukewarm water and mild dish soap; do not use a flea bath unless your vet says so.', 'Call your veterinarian or ASPCA APCC immediately.'],
    avoid: ['Never use a dog flea product on a cat, and keep cats away from treated dogs until the product is dry.'],
    products: [
      { id: 'spot-on', label: 'Dog spot-on flea product', aliases: ['spot-on', 'flea treatment', 'flea medicine'], mgPerMl: 450, gramsPerPiece: 4 },
      { id: 'spray', label: 'Flea spray', aliases: ['spray', 'flea spray'], mgPerMl: 2, gramsPerPiece: 100 },
      { id: 'collar', label: 'Flea collar', aliases: ['collar', 'flea collar'], mgPerPiece: 500 },
    ],
    defaultProductId: 'spot-on',
    sources: [PERMETHRIN_SOURCE, aspca('Flea and tick product safety', 'Read the label carefully: some flea products safe for dogs are toxic to cats.', 'https://www.aspca.org/pet-care/animal-poison-control')],
    limitations: ['The concentration of permethrin varies widely by product; when the product is unknown, Vetwise will not estimate a dose.'],
  },
  {
    id: 'rodenticide',
    name: 'Rodenticide (rat or mouse poison)',
    aliases: ['rodenticide', 'rat poison', 'mouse poison', 'rat bait', 'mouse bait', 'bromethalin', 'brodifacoum', 'warfarin bait', 'cholecalciferol', 'vitamin d bait'],
    category: 'pesticide',
    species: ['dog', 'cat'],
    summary: 'Rodenticides are designed to be eaten and can cause uncontrolled bleeding, brain swelling, or severe calcium imbalance.',
    mechanism: 'Depends on the active ingredient: anticoagulants block vitamin K, bromethalin causes cerebral edema, cholecalciferol causes hypercalcemia.',
    basis: 'g_per_kg',
    unitLabel: 'exposure',
    bands: [],
    anyAmountVerdict: 'emergency',
    amountOptional: true,
    anyAmountNote: 'Any exposure to rat or mouse poison is an emergency. Bring the bait station or package so the vet knows the active ingredient.',
    signs: ['bleeding', 'bruising', 'lethargy', 'weakness', 'tremors', 'seizures', 'difficulty breathing'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing'],
    firstAid: ['Move your pet away from the bait and keep the package.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC immediately; treatment depends on the active ingredient.'],
    avoid: ['Do not use rodent bait in areas a pet can reach, even in a bait station.'],
    sources: [RODENTICIDE_SOURCE, aspca('Rodenticides', 'Rodenticide baits are designed to be eaten; depending on the active ingredient they can cause uncontrolled bleeding, brain swelling, or severe calcium imbalance.')],
    limitations: ['The active ingredient changes the antidote and the monitoring plan; a photo of the package is the most useful thing to bring.'],
  },
  {
    id: 'ethylene-glycol',
    name: 'Ethylene glycol (antifreeze)',
    aliases: ['ethylene glycol', 'antifreeze', 'coolant', 'radiator fluid', 'de-icer', 'screen wash'],
    category: 'household',
    species: ['dog', 'cat'],
    summary: 'Ethylene glycol tastes sweet and causes acute kidney failure; even a small amount can be fatal.',
    mechanism: 'Ethylene glycol is metabolized to oxalic acid, which precipitates calcium oxalate crystals in the kidneys.',
    basis: 'ml_per_kg',
    unitLabel: 'exposure',
    bands: [],
    anyAmountVerdict: 'emergency',
    amountOptional: true,
    anyAmountNote: 'Any suspected antifreeze exposure is an emergency. Treatment is most effective within the first few hours.',
    signs: ['wobbliness', 'vomiting', 'excessive thirst', 'increased urination', 'decreased urine', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing'],
    firstAid: ['Move your pet away from the spill and rinse the mouth.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC immediately; do not wait for symptoms.'],
    avoid: ['Clean up antifreeze spills immediately and store containers in a locked cabinet.'],
    products: [
      { id: 'antifreeze', label: 'Antifreeze', aliases: ['antifreeze', 'coolant'], gramsPerPiece: 30 },
      { id: 'spill', label: 'Small spill or lick', aliases: ['lick', 'spill', 'taste'], gramsPerPiece: 5 },
    ],
    defaultProductId: 'antifreeze',
    sources: [ETHYLENE_GLYCOL_SOURCE, aspca('Antifreeze poisoning', 'Ethylene glycol antifreeze is extremely toxic to pets; even a small amount can cause kidney failure.', 'https://www.aspca.org/pet-care/animal-poison-control')],
  },
  {
    id: 'mothballs',
    name: 'Mothballs',
    aliases: ['mothball', 'mothballs', 'naphthalene', 'paradichlorobenzene', 'moth repellent'],
    category: 'household',
    species: ['dog', 'cat'],
    summary: 'Mothballs contain naphthalene or paradichlorobenzene; ingestion can cause hemolysis and neurologic signs.',
    mechanism: 'Naphthalene causes oxidative hemolysis and methemoglobinemia; paradichlorobenzene causes liver and neurologic injury.',
    basis: 'g_per_kg',
    unitLabel: 'g/kg mothball material',
    bands: [
      { at: 0, label: 'Any mothball ingestion', verdict: 'call_vet', detail: 'Even one mothball can cause signs in a small pet.' },
      { at: 1, label: 'Significant mothball dose', verdict: 'emergency', detail: 'Hemolysis, methemoglobinemia, and seizures are possible.' },
    ],
    anyAmountVerdict: 'call_vet',
    signs: ['vomiting', 'drooling', 'lethargy', 'pale or brown gums', 'tremors', 'seizures'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Remove the mothball and keep the package.', 'Do not induce vomiting unless a veterinarian or poison control tells you to.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not use mothballs around pets, and do not store clothing with them where a pet can reach.'],
    products: [
      { id: 'mothball', label: 'Mothball', aliases: ['mothball', 'ball'], gramsPerPiece: 5 },
      { id: 'pack', label: 'Pack of mothballs', aliases: ['pack', 'box'], gramsPerPiece: 50 },
    ],
    defaultProductId: 'mothball',
    sources: [MOTHBALL_SOURCE, MOTHBALL_SOURCE_PPH],
  },
  {
    id: 'essential-oils',
    name: 'Essential oils',
    aliases: ['essential oil', 'essential oils', 'tea tree', 'tea tree oil', 'melaleuca', 'eucalyptus', 'peppermint', 'lavender', 'citrus oil', 'diffuser', 'aromatherapy'],
    category: 'household',
    species: ['dog', 'cat'],
    summary: 'Essential oils can cause drooling, vomiting, wobbliness, and aspiration pneumonia; cats are especially vulnerable.',
    mechanism: 'Terpenes and phenols are hepatotoxic and neurotoxic; oily products can be aspirated if vomited.',
    basis: 'ml_per_kg',
    unitLabel: 'ml/kg essential oil',
    bands: [
      { at: 0, label: 'Any exposure', verdict: 'call_vet', detail: 'Cats lack efficient glucuronidation and can react to small amounts.' },
      { at: 1, label: 'Significant oil exposure', verdict: 'emergency', detail: 'Tremors, coma, and aspiration pneumonia are possible.' },
    ],
    bandsBySpecies: {
      cat: [
        { at: 0, label: 'Any feline exposure', verdict: 'call_vet', detail: 'Cats can react to small amounts, including from a diffuser or spilled bottle.' },
        { at: 1, label: 'Significant feline exposure', verdict: 'emergency', detail: 'Tremors, coma, and aspiration pneumonia are possible.' },
      ],
      dog: [
        { at: 0, label: 'Any exposure', verdict: 'call_vet', detail: 'Keep the bottle away and call your vet for advice.' },
        { at: 1, label: 'Significant canine exposure', verdict: 'emergency', detail: 'Tremors and aspiration pneumonia are possible.' },
      ],
    },
    anyAmountVerdict: 'call_vet',
    signs: ['drooling', 'vomiting', 'wobbliness', 'lethargy', 'tremors', 'difficulty breathing'],
    severeSigns: ['seizure', 'collapse', 'difficulty_breathing', 'tremors'],
    firstAid: ['Move your pet to fresh air and wipe any oil off the skin with a damp cloth.', 'Do not induce vomiting; oily products can be aspirated.', 'Call your veterinarian or ASPCA APCC.'],
    avoid: ['Do not use diffusers, sprays, or topical oils around cats; do not apply tea tree oil to any pet.'],
    products: [
      { id: 'tea-tree', label: 'Tea tree oil', aliases: ['tea tree', 'tea tree oil', 'melaleuca'], verdict: 'emergency', gramsPerPiece: 5 },
      { id: 'eucalyptus', label: 'Eucalyptus oil', aliases: ['eucalyptus'], gramsPerPiece: 5 },
      { id: 'peppermint', label: 'Peppermint oil', aliases: ['peppermint', 'mint'], gramsPerPiece: 5 },
      { id: 'lavender', label: 'Lavender oil', aliases: ['lavender'], gramsPerPiece: 5 },
      { id: 'diffuser', label: 'Diffuser exposure', aliases: ['diffuser', 'aromatherapy', 'spray'], gramsPerPiece: 1 },
    ],
    defaultProductId: 'tea-tree',
    sources: [ESSENTIAL_OIL_SOURCE, TEA_TREE_SOURCE],
    limitations: ['“Essential oil” is a category, not one substance; tea tree and other concentrated oils are more dangerous than a light lavender scent.'],
  },
];

export const TOXIN_BY_ID = new Map(TOXINS.map((toxin) => [toxin.id, toxin]));

const ALIAS_INDEX = new Map<string, Toxin>();
for (const toxin of TOXINS) {
  for (const alias of [toxin.id, toxin.name, ...toxin.aliases]) {
    ALIAS_INDEX.set(alias.toLowerCase(), toxin);
  }
}

/** Find a toxin by id, exact name, or a generous spoken alias. */
export function findToxin(input: string): Toxin | undefined {
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  const direct = ALIAS_INDEX.get(value) ?? TOXIN_BY_ID.get(value);
  if (direct) return direct;
  return TOXINS.find((toxin) =>
    [toxin.id, toxin.name, ...toxin.aliases].some((alias) => {
      const candidate = alias.toLowerCase();
      return candidate.length >= 4 && (value.includes(candidate) || candidate.includes(value));
    }),
  );
}

export function findProduct(toxin: Toxin, input?: string): ToxinProduct | undefined {
  if (!input) return toxin.products?.find((product) => product.id === toxin.defaultProductId);
  const value = input.trim().toLowerCase();
  if (!value) return toxin.products?.find((product) => product.id === toxin.defaultProductId);
  return (
    toxin.products?.find((product) => product.id === value) ??
    toxin.products?.find((product) => product.label.toLowerCase() === value) ??
    toxin.products?.find((product) =>
      [product.id, product.label, ...product.aliases].some((alias) => {
        const candidate = alias.toLowerCase();
        return candidate.length >= 3 && (value.includes(candidate) || candidate.includes(value));
      }),
    )
  );
}

export function bandsFor(toxin: Toxin, species: Species | 'unknown'): DoseBand[] {
  if (species !== 'unknown' && toxin.bandsBySpecies?.[species]) return toxin.bandsBySpecies[species]!;
  return toxin.bands;
}

export const TOXIN_COUNT = TOXINS.length;
