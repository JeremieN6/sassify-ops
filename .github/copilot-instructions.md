# Instructions Copilot

## Demarrage de session (OBLIGATOIRE)
1. Lis CLAUDE.md a la racine pour l etat du projet
2. Lis tasks/lessons.md pour les regles apprises et patterns a eviter
3. Lis tasks/todo.md pour les taches en cours
4. Interroge la memoire MCP (read_graph) pour le contexte de la session precedente

---

## Regles de Travail

### 1. Plan Mode
- Entrer en mode plan pour TOUTE tache non triviale (3+ etapes ou decisions architecturales)
- Si ca part en vrille : STOP, re-planifier avant de continuer
- Ecrire des specs detaillees en amont pour reduire l ambiguite
- Ecrire le plan dans tasks/todo.md avec des items cochables

### 2. Strategie Subagents
- Utiliser des subagents pour garder la fenetre de contexte principale propre
- Deleguer la recherche, l exploration et l analyse parallele aux subagents
- Pour les problemes complexes : plus de compute via subagents
- Une tache par subagent pour une execution focalisee

### 3. Boucle Auto-Amelioration
- Apres TOUTE correction de l utilisateur : mettre a jour tasks/lessons.md
- Ecrire une regle explicite pour eviter la meme erreur
- Relire lessons.md au debut de chaque session
- Format : Probleme / Cause racine / Solution / Regle

### 4. Verification Avant Done
- Ne jamais marquer une tache complete sans prouver que ca fonctionne
- Se demander : "Un senior engineer approuverait-il ca ?"
- Lancer les tests, verifier les logs, demontrer la correction

### 5. Exiger l Elegance
- Pour les changements non triviaux : "y a-t-il une solution plus elegante ?"
- Si un fix semble hacky : reimplementer la solution propre
- Ne pas sur-ingenierer les fixes simples et evidents

### 6. Bug Fixing Autonome
- Quand un bug est reporte : le corriger directement
- Pointer les logs, erreurs, tests en echec puis resoudre
- Zero interruption de contexte pour l utilisateur

---

## Gestion des Taches

1. **Planifier** : Ecrire le plan dans tasks/todo.md avec items cochables
2. **Verifier le plan** : S assurer de l alignement avant d implementer
3. **Suivre la progression** : Cocher les items au fur et a mesure
4. **Expliquer les changements** : Resume de haut niveau a chaque etape
5. **Documenter** : Ajouter une section revue dans tasks/todo.md
6. **Capturer les lecons** : Mettre a jour tasks/lessons.md apres corrections

---

## Principes Fondamentaux

- **Simplicite d abord** : Chaque changement aussi simple que possible. Impact minimal sur le code.
- **Pas de flemme** : Trouver les causes racines. Pas de fixes temporaires. Standards senior dev.

---

## Workflow Memoire MCP
- Debut : read_graph pour charger le contexte
- Pendant : create_entities / add_observations pour stocker les decisions
- Fin : proposer un resume pour CLAUDE.md > Notes de Session
