# DaCard
![image](https://raw.githubusercontent.com/gurobase/DaCard/8e9251f5163d9389a7ca3c8b36ca1d610db61160/dacard.gif)

Gotta collect them all.

Example cards are a separate download: import them under **Collections**.

## Features
- Collectable cards that can be found around the world.
- Card binders that can store your cards. Binders stay in the stash: they can't be taken into a raid.
- Booster packs for card unboxing: each pack opens cards of one collection.
- A new trader called Geek.
- Most of the numbers are configurable (prices, chances).
- Easy to use tools for custom Cards/Collections/Booster Packs creation with a layer system (**each layer has a chance based system for appearing on a card!**) without having to bundle them in Unity.
- Custom rarities per collection: name, colour, price and chance. A card roll picks a rarity first (0–100 ranges), then a random card of it.
- Foil per layer: every layer that can be foil rolls its own foil (10% by default, per collection or per layer) and its own foil type (Rainbow, Linear, Radial, Sparkle, Galaxy, Diamond, Squares, Circles, Surge, Ripple, Speckle, Crackle). A foil mask limits the foil to part of a layer. Foils raise a copy's price up to ×2, shared between the layers that could be foil.
- Variant layers: one layer, several versions, exactly one rolled per copy by its chance (a rare evolved character over the common base one). Each variant has its own pictures and foil setup.
- Layers can be just a mask, for normal map effects without a picture.
- Built for big collections: cards share one item per collection and rarity, so tens of thousands of cards don't slow the game down.
- 3D cards.
- Optional setup for mask and depth generation using ComfyUI for 3D cards.
- Collections export and import as a single .zip, so they are easy to share.
- Everything is kept in one database (`data/dacard.db`, pictures next to it in `data/collections/`), read by the server only when it needs it.
- Safeguard for removed/broken cards/binders/booster packs that runs on server startup.
- The game keeps downloaded cards in `BepInEx\cache\DaCard` and only downloads what changed. Deleting that folder is safe.

## DaCard Dashboard
- Run **SPT_Runtime\user\mods\Guro-DaCard\DaCard Dashboard.bat**. It opens the dashboard at http://127.0.0.1:6967 in your browser.
- Keep its window open while you work. Closing the browser tab does not stop anything that is running (imports, exports, updates).
- Restart the SPT server to get your changes in game.
- The port can be changed in `dashboard\settings.json`.
![image](https://media.githubusercontent.com/media/gurobase/DaCard/main/dacard_card_edit.png)

## Updating from 1.x
Your addons are moved into the database automatically, the first time the SPT server starts or the dashboard opens. The old folders are kept in `data\_legacy\`. Item IDs stay the same, so cards players already own keep working. Old addon .zip files can still be imported under **Collections**.

## Updating from 2.0.x
Cards, foil cards and their stickers in your profiles are converted the first time the SPT server starts: every copy keeps its card and the layers it rolled, foil cards become foil on every layer that can be foil. A backup of each profile is saved in `user\dacard\backups\` before it changes. Update the server mod and the client plugin together.

Settings move over on their own: the booster pack rarity chances become the rarity chances, and the per-rarity spawn chances become one card chance per container. Booster packs that covered several collections now open the collection most of their cards came from. The dashboard lists each change once. If `data\_legacy\` still holds pre-2.0 data, the dashboard reminds you that it was already imported and can be deleted.

## Collections
Collections would be greatly appreciated and future updates will expand the possibilities of the card editor.
