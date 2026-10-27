# FR/ES strings for the AI agent "First message" / wait-for-hello / script guide UI (2026-10).
import json
T = {
'Example first message: “Hi {lead_name|there}, this is {name} from {business}. You asked about solar panels last week, do you have a minute?”': (
  'Exemple de premier message : « Bonjour {lead_name}, ici {name} de {business}. Vous vous êtes renseigné sur les panneaux solaires la semaine dernière, avez-vous une minute ? »',
  'Ejemplo de primer mensaje: “Hola {lead_name}, soy {name} de {business}. La semana pasada pidió información sobre paneles solares, ¿tiene un minuto?”'),
'First message (optional)': ('Premier message (facultatif)', 'Primer mensaje (opcional)'),
'Hi {lead_name|there}, this is {name} from {business}. Do you have a minute?': (
  'Bonjour {lead_name}, ici {name} de {business}. Avez-vous une minute ?',
  'Hola {lead_name}, soy {name} de {business}. ¿Tiene un minuto?'),
'How to write a script that sounds natural': ('Comment écrire un script qui sonne naturel', 'Cómo escribir un guion que suene natural'),
'Keep it short and ask one question at a time': ('Restez bref et posez une question à la fois', 'Sé breve y haz una pregunta a la vez'),
'Lead without a name:': ('Contact sans nom :', 'Contacto sin nombre:'),
'On calls to leads, the agent stays quiet until the person answers (“Hello?”), then speaks. If nobody says anything for 4 seconds, it starts anyway.': (
  'Lors des appels vers vos contacts, l’agent reste silencieux jusqu’à ce que la personne réponde (« Allô ? »), puis il parle. Si personne ne dit rien pendant 4 secondes, il commence quand même.',
  'En las llamadas a tus contactos, el agente espera en silencio hasta que la persona contesta (“¿Diga?”) y luego habla. Si nadie dice nada en 4 segundos, empieza igualmente.'),
'Phone replies should be one or two short sentences. List the questions in the order you want them asked.': (
  'Au téléphone, une réponse tient en une ou deux phrases courtes. Listez les questions dans l’ordre où vous voulez qu’elles soient posées.',
  'Por teléfono, cada respuesta debe tener una o dos frases cortas. Enumera las preguntas en el orden en que quieres que se hagan.'),
'Put prices, hours and policies in “FAQs & facts”': ('Mettez les prix, horaires et conditions dans « FAQ et informations »', 'Pon precios, horarios y políticas en “Preguntas frecuentes y datos”'),
'Put the greeting in “First message” only': ('Mettez la salutation uniquement dans « Premier message »', 'Pon el saludo solo en “Primer mensaje”'),
'Say what the agent should find out and how it should sound. A long speech makes it talk in long blocks and sound robotic.': (
  'Indiquez ce que l’agent doit découvrir et le ton à adopter. Un long discours le fait parler par longs blocs et sonner comme un robot.',
  'Indica qué debe averiguar el agente y cómo debe sonar. Un discurso largo hace que hable en bloques largos y suene robótico.'),
'Say when to transfer, when to take a message and when to say goodbye. Notes in [brackets] are never read aloud.': (
  'Précisez quand transférer, quand prendre un message et quand dire au revoir. Les notes entre [crochets] ne sont jamais lues à voix haute.',
  'Indica cuándo transferir, cuándo tomar un mensaje y cuándo despedirse. Las notas entre [corchetes] nunca se leen en voz alta.'),
'Tell it how to end': ('Dites-lui comment terminer', 'Dile cómo terminar'),
'The AI notice and, on recorded calls, the recording notice are added for you when your text leaves them out. They are required on every call.': (
  'La mention IA et, pour les appels enregistrés, la mention d’enregistrement sont ajoutées pour vous si votre texte ne les contient pas. Elles sont obligatoires à chaque appel.',
  'El aviso de IA y, en las llamadas grabadas, el aviso de grabación se añaden por ti si tu texto no los incluye. Son obligatorios en cada llamada.'),
'The agent only states facts that are written there, so it never invents a price or a promise.': (
  'L’agent n’annonce que les informations écrites ici : il n’invente jamais un prix ni une promesse.',
  'El agente solo dice los datos que están escritos ahí, así que nunca inventa un precio ni una promesa.'),
'The agent opens the call with your first message and never greets again. Start the script with what comes after the greeting.': (
  'L’agent ouvre l’appel avec votre premier message et ne salue plus jamais ensuite. Commencez le script par ce qui vient après la salutation.',
  'El agente abre la llamada con tu primer mensaje y no vuelve a saludar. Empieza el guion con lo que viene después del saludo.'),
'The exact words that open every call. Use {name}, {business} and {lead_name} (or {lead_name|there} for leads without a name). Leave empty for the standard opening.': (
  'Les mots exacts qui ouvrent chaque appel. Utilisez {name}, {business} et {lead_name} (ou {lead_name|texte de secours} pour les contacts sans nom). Laissez vide pour l’ouverture standard.',
  'Las palabras exactas con las que empieza cada llamada. Usa {name}, {business} y {lead_name} (o {lead_name|texto alternativo} para contactos sin nombre). Déjalo vacío para usar el saludo estándar.'),
'Wait for them to say hello': ('Attendre que la personne dise allô', 'Esperar a que la persona salude'),
'What the agent does after the first message, how it talks and what it should find out.': (
  'Ce que fait l’agent après le premier message, comment il parle et ce qu’il doit découvrir.',
  'Qué hace el agente después del primer mensaje, cómo habla y qué debe averiguar.'),
'What the agent says first': ('Ce que l’agent dit en premier', 'Lo que el agente dice primero'),
'When it answers your number': ('Quand il répond à votre numéro', 'Cuando contesta tu número'),
'When it calls a lead (sample name “{0}”)': ('Quand il appelle un contact (nom d’exemple « {0} »)', 'Cuando llama a un contacto (nombre de ejemplo “{0}”)'),
'Write goals and rules, not a word-for-word speech': ('Écrivez des objectifs et des règles, pas un discours mot à mot', 'Escribe objetivos y reglas, no un discurso palabra por palabra'),
'You play the lead “Alex”. Say “Hello?” first — the agent waits for you, like on a real call.': (
  'Vous jouez le contact « Alex ». Dites d’abord « Allô ? » : l’agent vous attend, comme lors d’un vrai appel.',
  'Tú haces de contacto “Alex”. Di primero “¿Diga?”: el agente te espera, como en una llamada real.'),
'You play the lead “Alex”. The agent speaks first, like when someone picks up.': (
  'Vous jouez le contact « Alex ». L’agent parle en premier, comme quand quelqu’un décroche.',
  'Tú haces de contacto “Alex”. El agente habla primero, como cuando alguien contesta.'),
}
# Appends only the keys that are missing (keeps the file's existing order and lines). Safe to re-run.
for i, lang in enumerate(('fr', 'es')):
    path = f'/app/frontend/src/cloudivr/i18n/{lang}.json'
    raw = open(path, encoding='utf-8').read()
    have = json.loads(raw)
    add = [f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v[i], ensure_ascii=False)}' for k, v in T.items() if k not in have]
    if not add:
        print(lang, 'up to date'); continue
    body = raw.rstrip()[:-1].rstrip()
    out = body + ',\n' + ',\n'.join(add) + '\n}\n'
    json.loads(out)
    open(path, 'w', encoding='utf-8').write(out)
    print(lang, len(have), '->', len(have) + len(add))
