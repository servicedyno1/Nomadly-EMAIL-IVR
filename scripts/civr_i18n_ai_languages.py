#!/usr/bin/env python3
"""FR/ES strings for the 20 AI agent languages (landing, AI agents page, language picker). Idempotent."""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '../frontend/src/cloudivr/i18n')

S = {
    "AI agent languages — it switches when your caller does": ("Langues de l’agent IA — il change de langue quand votre appelant le fait", "Idiomas del agente IA — cambia de idioma cuando lo hace quien llama"),
    "Talks with callers in 20 languages, books visits and calls your leads.": ("Parle avec vos appelants dans 20 langues, prend les rendez-vous et appelle vos prospects.", "Habla con quien llama en 20 idiomas, agenda citas y llama a tus clientes potenciales."),
    "Your best rep on every line, 24/7. It talks naturally in 20 languages — answers questions, books appointments, takes messages and passes hot calls to you. Point it at your leads and it calls them too. Billed per minute from your wallet.": ("Votre meilleur représentant sur chaque ligne, 24h/24 et 7j/7. Il parle naturellement 20 langues — répond aux questions, prend des rendez-vous, note les messages et vous transfère les appels importants. Orientez-le vers vos prospects, il les appelle aussi. Facturé à la minute depuis votre portefeuille.", "Tu mejor representante en cada línea, 24/7. Habla con naturalidad 20 idiomas — responde preguntas, agenda citas, toma mensajes y te transfiere llamadas importantes. Apúntalo a tus prospectos y también los llama. Facturado por minuto desde tu billetera."),
    "An AI that answers your number or calls your leads, in 20 languages — with natural, fast conversation.": ("Une IA qui répond à votre numéro ou appelle vos prospects, dans 20 langues — avec une conversation naturelle et rapide.", "Una IA que responde tu número o llama a tus prospectos, en 20 idiomas — con conversación natural y rápida."),
    "Arabic": ("Arabe", "Árabe"),
    "Chinese (Mandarin)": ("Chinois (mandarin)", "Chino (mandarín)"),
    "Czech": ("Tchèque", "Checo"),
    "Dutch": ("Néerlandais", "Neerlandés"),
    "German": ("Allemand", "Alemán"),
    "Hebrew": ("Hébreu", "Hebreo"),
    "Hindi": ("Hindi", "Hindi"),
    "Indonesian": ("Indonésien", "Indonesio"),
    "Italian": ("Italien", "Italiano"),
    "Japanese": ("Japonais", "Japonés"),
    "Korean": ("Coréen", "Coreano"),
    "Polish": ("Polonais", "Polaco"),
    "Portuguese": ("Portugais", "Portugués"),
    "Romanian": ("Roumain", "Rumano"),
    "Russian": ("Russe", "Ruso"),
    "Turkish": ("Turc", "Turco"),
    "Vietnamese": ("Vietnamien", "Vietnamita"),
}


def main():
    for i, lang in enumerate(('fr', 'es')):
        p = os.path.join(ROOT, f'{lang}.json')
        s = open(p, encoding='utf-8').read()
        cur = json.loads(s)
        new = {k: v[i] for k, v in S.items() if k not in cur}
        if not new:
            print(lang, 'nothing to add'); continue
        lines = ''.join(json.dumps(k, ensure_ascii=False) + ': ' + json.dumps(v, ensure_ascii=False) + ',\n' for k, v in new.items())
        assert s.startswith('{\n')
        s = '{\n' + lines + s[2:]
        json.loads(s)
        open(p, 'w', encoding='utf-8').write(s)
        print(lang, 'added', len(new))


if __name__ == '__main__':
    main()
