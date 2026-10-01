# DaCard
![image](https://raw.githubusercontent.com/gurobase/DaCard/8e9251f5163d9389a7ca3c8b36ca1d610db61160/dacard.gif)

Gotta collect them all.

Example cards are a separate download: import them under **Collections**.

## Features
- Collectable cards that can be found around the world.
- Card binders that can store your cards.
- Booster packs for card unboxing, per collection or across every collection.
- A new trader called Geek.
- Most of the numbers are configurable (prices, chances).
- Easy to use tools for custom Cards/Collections/Booster Packs creation with a layer system (**each layer has a chance based system for appearing on a card!**) without having to bundle them in Unity.
- 3D cards.
- Optional setup for mask and depth generation using ComfyUI for 3D cards.
- Collections export and import as a single .zip, so they are easy to share.
- Everything is kept in one database (`data/dacard.db`, pictures next to it in `data/collections/`), read by the server only when it needs it.
- Safeguard for removed/broken cards/binders/booster packs that runs on server startup.

## DaCard Dashboard
- Run **SPT_Runtime\user\mods\Guro-DaCard\DaCard Dashboard.bat**. It opens the dashboard at http://127.0.0.1:6967 in your browser.
- Keep its window open while you work. Closing the browser tab does not stop anything that is running (imports, exports, updates).
- Restart the SPT server to get your changes in game.
- The port can be changed in `dashboard\settings.json`.
![image](https://media.githubusercontent.com/media/gurobase/DaCard/main/dacard_card_edit.png)

## Updating from 1.x
Your addons are moved into the database automatically, the first time the SPT server starts or the dashboard opens. The old folders are kept in `data\_legacy\`. Item IDs stay the same, so cards players already own keep working. Old addon .zip files can still be imported under **Collections**.

## Collections
Collections would be greatly appreciated and future updates will expand the possibilities of the card editor.
