/* Eigene Warenliste für die Vorschläge beim Eintippen auf dem Einkaufszettel (norddeutscher Sprachgebrauch).
   Schlüssel = Kategorie-ID des Zettels; Reihenfolge innerhalb einer Kategorie spielt keine Rolle.
   Gewichtung beim Suchen: eigener Verlauf > Waren > Warengruppen aus den Angeboten > Marken. */
const LI_GOODS = {
  obst: 'Äpfel, Bananen, Birnen, Orangen, Mandarinen, Clementinen, Zitronen, Limetten, Weintrauben, Erdbeeren, Himbeeren, ' +
    'Heidelbeeren, Kirschen, Pflaumen, Nektarinen, Pfirsiche, Aprikosen, Kiwis, Mango, Ananas, Melone, Wassermelone, ' +
    'Grapefruit, Avocado, Granatapfel, Feigen, Datteln, Beeren, Obst, Tomaten, Cherrytomaten, Gurke, Salatgurke, Paprika, ' +
    'Zucchini, Aubergine, Möhren, Karotten, Kartoffeln, Süßkartoffeln, Zwiebeln, Rote Zwiebeln, Frühlingszwiebeln, ' +
    'Knoblauch, Lauch, Porree, Sellerie, Staudensellerie, Brokkoli, Blumenkohl, Rosenkohl, Grünkohl, Rotkohl, Weißkohl, ' +
    'Wirsing, Spitzkohl, Kohlrabi, Spinat, Mangold, Rucola, Eisbergsalat, Kopfsalat, Feldsalat, Salat, Radieschen, ' +
    'Rote Bete, Kürbis, Hokkaido, Champignons, Pilze, Spargel, Mais, Erbsen, Bohnen, Grüne Bohnen, Fenchel, Pastinaken, ' +
    'Ingwer, Chili, Petersilie, Schnittlauch, Basilikum, Dill, Minze, Koriander, Kräuter, Suppengrün, Gemüse, Nüsse, ' +
    'Walnüsse, Haselnüsse, Mandeln, Cashewkerne, Erdnüsse, Rosinen',
  brot: 'Brot, Brötchen, Toast, Toastbrot, Vollkornbrot, Schwarzbrot, Roggenbrot, Pumpernickel, Baguette, Ciabatta, ' +
    'Laugenbrezel, Brezeln, Croissants, Aufbackbrötchen, Knäckebrot, Zwieback, Wraps, Tortillas, Fladenbrot, Burgerbrötchen, ' +
    'Hotdog-Brötchen, Kuchen, Blechkuchen, Berliner, Rosinenbrötchen, Stuten, Butterkuchen, Hefezopf',
  kuehl: 'Milch, Frischmilch, H-Milch, Hafermilch, Sojamilch, Mandelmilch, Buttermilch, Butter, Margarine, Joghurt, ' +
    'Naturjoghurt, Griechischer Joghurt, Fruchtjoghurt, Quark, Magerquark, Skyr, Sahne, Schlagsahne, Saure Sahne, ' +
    'Schmand, Crème fraîche, Kaffeesahne, Kondensmilch, Pudding, Milchreis, Grießpudding, Eier, Frischkäse, Kräuterquark, ' +
    'Tzatziki, Hummus, Tofu, Pesto, Frische Nudeln, Tortellini, Gnocchi, Pizzateig, Blätterteig, Hefeteig, Kefir, Ayran, ' +
    'Desserts, Smoothie',
  kaese: 'Käse, Gouda, Edamer, Emmentaler, Butterkäse, Tilsiter, Bergkäse, Parmesan, Grana Padano, Mozzarella, Burrata, ' +
    'Feta, Hirtenkäse, Halloumi, Camembert, Brie, Ziegenkäse, Gorgonzola, Scheibenkäse, Reibekäse, Streukäse, Hüttenkäse, ' +
    'Körniger Frischkäse, Schmelzkäse, Harzer, Babybel',
  wurst: 'Wurst, Aufschnitt, Salami, Schinken, Kochschinken, Katenschinken, Serrano, Leberwurst, Teewurst, Mettwurst, ' +
    'Zervelatwurst, Bierschinken, Lyoner, Fleischwurst, Mortadella, Geflügelwurst, Putenbrust, Wiener Würstchen, ' +
    'Bockwurst, Frankfurter, Grützwurst, Blutwurst, Speck, Bacon, Schinkenwürfel, Frikadellen, Leberkäse, Sülze',
  fleisch: 'Hackfleisch, Rinderhack, Gemischtes Hack, Hähnchen, Hähnchenbrust, Hähnchenschenkel, Chicken Wings, Putenbrust, ' +
    'Putenschnitzel, Schnitzel, Schweinefilet, Schweinenacken, Kotelett, Nackensteak, Rindfleisch, Rinderhüfte, Steak, ' +
    'Rumpsteak, Gulasch, Rouladen, Braten, Schweinebraten, Rinderbraten, Kassler, Bratwurst, Grillwurst, Grillfleisch, ' +
    'Spareribs, Geschnetzeltes, Lammkeule, Ente, Gans, Leber, Lachs, Räucherlachs, Forelle, Kabeljau, Seelachs, ' +
    'Thunfisch, Garnelen, Scampi, Matjes, Hering, Bismarckhering, Rollmops, Fischstäbchen, Backfisch, Fisch',
  tk: 'Pizza, Tiefkühlpizza, Pommes, Kroketten, Rösti, Tiefkühlgemüse, Rahmspinat, Erbsen & Möhren, Kaisergemüse, ' +
    'Buttergemüse, Beerenmischung, Eis, Eiscreme, Speiseeis, Stieleis, Fischstäbchen, Schlemmerfilet, Chicken Nuggets, ' +
    'Frühlingsrollen, Baguettes, Flammkuchen, Lasagne, Maultaschen, Eiswürfel, Kräuter (TK), Blätterteig (TK), Brötchen (TK)',
  vorrat: 'Nudeln, Spaghetti, Penne, Fusilli, Farfalle, Makkaroni, Bandnudeln, Spätzle, Lasagneplatten, Reis, Basmatireis, ' +
    'Jasminreis, Risottoreis, Milchreis, Couscous, Bulgur, Quinoa, Linsen, Kichererbsen, Kidneybohnen, Weiße Bohnen, ' +
    'Mais (Dose), Erbsen (Dose), Tomaten (Dose), Passierte Tomaten, Tomatenmark, Pizzatomaten, Sauerkraut, Rotkohl (Glas), ' +
    'Gurken (Glas), Gewürzgurken, Oliven, Kapern, Rote Bete (Glas), Apfelmus, Pfirsiche (Dose), Ananas (Dose), ' +
    'Thunfisch (Dose), Sardinen, Suppe, Eintopf, Ravioli, Brühe, Gemüsebrühe, Hühnerbrühe, Fertiggerichte, Instantnudeln, ' +
    'Kartoffelpüree, Semmelknödel, Kartoffelknödel, Soße, Bratensoße, Tomatensoße, Pastasoße, Pesto (Glas), Currysoße',
  backen: 'Mehl, Weizenmehl, Dinkelmehl, Vollkornmehl, Zucker, Puderzucker, Brauner Zucker, Vanillezucker, Backpulver, ' +
    'Hefe, Trockenhefe, Speisestärke, Kakao, Backkakao, Kuvertüre, Schokotropfen, Gelatine, Tortenguss, Streusel, ' +
    'Backmischung, Paniermehl, Semmelbrösel, Gemahlene Mandeln, Kokosraspel, Öl, Sonnenblumenöl, Rapsöl, Olivenöl, ' +
    'Bratöl, Essig, Balsamico, Salz, Pfeffer, Paprikapulver, Curry, Zimt, Muskat, Oregano, Kräuter der Provence, ' +
    'Gewürze, Gewürzmischung, Knoblauchpulver, Chiliflocken, Brühwürfel, Senf, Ketchup, Mayonnaise, Remoulade, ' +
    'Grillsoße, Sojasoße, Worcestersoße, Tabasco, Salatdressing, Salatkräuter, Sahnesteif',
  fruehstueck: 'Marmelade, Konfitüre, Honig, Nutella, Nuss-Nougat-Creme, Erdnussbutter, Frühstückscerealien, Cornflakes, ' +
    'Müsli, Haferflocken, Porridge, Granola, Knuspermüsli, Schokomüsli, Ahornsirup, Brotaufstrich, Streichcreme, ' +
    'Frischkäse, Rübenkraut, Schokostreusel, Hagelslag',
  suess: 'Schokolade, Vollmilchschokolade, Zartbitterschokolade, Pralinen, Gummibärchen, Fruchtgummi, Lakritz, Bonbons, ' +
    'Kaugummi, Kekse, Butterkekse, Schokokekse, Waffeln, Riegel, Müsliriegel, Schokoriegel, Chips, Kartoffelchips, ' +
    'Tortilla-Chips, Salzstangen, Erdnussflips, Popcorn, Cracker, Nüsse (Snack), Studentenfutter, Trockenobst, ' +
    'Kuchen (abgepackt), Muffins, Donuts, Spekulatius, Lebkuchen, Dominosteine',
  kaffee: 'Kaffee, Kaffeebohnen, Gemahlener Kaffee, Espresso, Kaffeepads, Kaffeekapseln, Instantkaffee, Cappuccino, ' +
    'Tee, Schwarzer Tee, Grüner Tee, Früchtetee, Kräutertee, Pfefferminztee, Kamillentee, Ostfriesentee, Kakao, ' +
    'Trinkschokolade, Kandis',
  getraenke: 'Wasser, Mineralwasser, Sprudel, Stilles Wasser, Medium Wasser, Saft, Apfelsaft, Orangensaft, Multivitaminsaft, ' +
    'Traubensaft, Apfelschorle, Schorle, Limonade, Cola, Cola Zero, Fanta, Sprite, Spezi, Eistee, Energydrink, Malzbier, ' +
    'Tonic Water, Ginger Ale, Bitter Lemon, Sirup, Iso-Drink',
  alkohol: 'Bier, Pils, Weizenbier, Radler, Alkoholfreies Bier, Export, Helles, Wein, Rotwein, Weißwein, Rosé, Sekt, ' +
    'Prosecco, Champagner, Glühwein, Likör, Korn, Wodka, Rum, Gin, Whisky, Aperol, Eierlikör, Schnaps',
  drogerie: 'Zahnpasta, Zahnbürste, Zahnseide, Mundspülung, Duschgel, Shampoo, Spülung, Seife, Flüssigseife, Handseife, ' +
    'Deo, Deodorant, Rasierer, Rasierklingen, Rasierschaum, Bodylotion, Handcreme, Gesichtscreme, Sonnencreme, Lippenpflege, ' +
    'Watte, Wattestäbchen, Wattepads, Taschentücher, Toilettenpapier, Feuchttücher, Binden, Tampons, Slipeinlagen, ' +
    'Haargel, Haarspray, Haarfarbe, Nagellackentferner, Pflaster, Kopfschmerztabletten, Vitamine, Kondome',
  haushalt: 'Spülmittel, Spülmaschinentabs, Klarspüler, Spülmaschinensalz, Waschmittel, Colorwaschmittel, Vollwaschmittel, ' +
    'Weichspüler, Fleckentferner, Allzweckreiniger, Badreiniger, WC-Reiniger, Glasreiniger, Entkalker, Scheuermilch, ' +
    'Schwämme, Spültücher, Putztücher, Mikrofasertücher, Küchenrolle, Küchenpapier, Müllbeutel, Gefrierbeutel, ' +
    'Frischhaltefolie, Alufolie, Backpapier, Servietten, Batterien, Glühbirnen, Kerzen, Teelichter, Streichhölzer, ' +
    'Grillkohle, Anzünder, Handschuhe, Luftballons',
  baby: 'Windeln, Feuchttücher (Baby), Babybrei, Gläschen, Babymilch, Folgemilch, Quetschie, Babyshampoo, Babycreme, ' +
    'Schnuller, Fruchtriegel (Kinder)',
  tier: 'Katzenfutter, Nassfutter, Trockenfutter, Hundefutter, Katzenstreu, Leckerli, Kauknochen, Vogelfutter, ' +
    'Fischfutter, Kleintierstreu, Heu',
  sonstiges: 'Blumen, Zeitschrift, Zeitung, Geschenkpapier, Geburtstagskarte, Pfandflaschen',
};
