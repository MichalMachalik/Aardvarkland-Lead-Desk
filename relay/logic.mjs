export const scenarios = {
  crm: {company: "Ateliér Lumen", subject: "Poptávky z webu do CRM"},
  price: {company: "Studio Oblouk", subject: "Dotaz na cenu"},
  booking: {company: "Dílna Sever", subject: "Potvrzování rezervací"}
};
export const topics = {crm:"Předávání poptávek do CRM",booking:"Potvrzování rezervací",unknown:"Upřesnění požadavku"};
export function drafts(a) {
  const question = a.intent === "crm" ? "Z jakého formuláře dnes poptávky přebíráte a jaké CRM používáte?" :
    a.intent === "booking" ? "Ve kterém systému rezervace evidujete a odkud mají odcházet potvrzení?" :
    "Jaký proces byste chtěli zjednodušit a kolikrát týdně ho řešíte?";
  return ["Dobrý den, děkujeme za zprávu. " + question, "Dobrý den, abychom mohli připravit konkrétní návrh, potřebujeme doplnit jednu věc. " + question];
}
export function valid(a) {
  return a && Object.hasOwn(topics,a.intent) && (a.weekly === null || (Number.isInteger(a.weekly) && a.weekly >= 0 && a.weekly <= 1000000)) && ["unknown","this_month","next_month"].includes(a.deadline);
}
