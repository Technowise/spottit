## Inspiration
This is a game of spotting things in a posted picture (inspired by /r/FindTheSniper subreddit). The game intends to bring a fun competition among the reddit community members with pictures posts that contain interesting things(related to your sub) camouflaged in them or contains something that is not very easy to spot(like a snake, an insect, a cat, or any small object). The app captures the time taken by each participant to find the spot and shows it in the leaderboard. Though it is fun finding things from usual posts in /r/FindTheSniper, we would not be aware of how long the members took to find the said spot.

## What it does
The app adds ability to create picture posts where post creator can mark specific spots in a picture and then ask other users to find that spot. Each participant's time taken to find the spot is recorded and used for ranking in the Leader-board. This game provides a built-in zoom feature, using which players can do pinch and zoom into sections of the picture to find the said spot. Those who wish to view the solution/spot can click on the eye icon - this will also abort the game for that participant.

## How we built it
The game is built using the Devvit platform(which includes CLI, AskAI tool, Play etc) and VS Code as the primary editor for building. The app primarily makes us of Blocks, and makes use multiple capabilities of Devvit platform - namely: Redis, Forms, Triggers, Webviews and Menu Actions. 

## Challenges we ran into
1. Implementing a zoom feature.
We initially tried to make this game using just the blocks layout system of Devvit platform, but we ran into a number of challenges in implementing a zoom feature with that ( as it does not yet have a built-in zoom feature). We tried to make a custom zoom functionality by setting the [image](https://developers.reddit.com/docs/blocks/image) height and width to 200%, and then using [alignment](https://developers.reddit.com/docs/blocks/stacks#alignment) attribute to show one of the four quadrants of the image. While doing so, we faced inconsistencies in behavior between different platforms (iOS/Android/web). We the issues to Devvit team, and they helped in sorting out the issues. Even after this, users wanted the usual pinch and zoom, which is much more flexible and it is something everyone is already familiar with. Since Devvit introduced webviews, we have now implemented the usual pinch and zoom feature using a Javascript library.
2. App crashing.
In initial versions of this devvit app, the reddit app itself was crashing while testing this app. It was reported to Devvit team, and crashing eventually stopped.
3. Issue with flairs.
The app was failing to create posts where flairs are required and had certain configuration for the flairs. I reported the issue with the Devvit team, and it was eventually sorted out by them. 

## Accomplishments that we're proud of
1. The app got a number of installs in reddit communities including [/r/FindTheSniper](https://www.reddit.com/r/FindTheSniper/) which this app was inspired by.
2. The app managed to qualify in Reddit Developer Funds program (Tier 1 - Qualified Views).

## What we learned
* Developing apps in a new platform can be both challenging and fulfilling experience.
It is a fulfilling experience building something new in a platform in it's early stages, but it comes with it's own challenges - because when we run across an issue, we can't be sure if it an issue with the code, or due to an issue with the platform. However, the devvit team provided great support! I've come to realize the potential of this platform - expecially the ability to make custom apps with content from reddit at our disposal(through APIs), and making it quickly available to a large user base of reddit.

## What's next for Spottit
1. Make the process of creating a new post much simpler than how it is presently through use of webviews, and give ability mark the spot more accurately.
2. Make animation on the double-clicked spot to indicate the exact spot that the user clicked (UX improvement).
3. Blur the image shown before starting the game so that there is lesser chance of cheating (through use of developer tools).
4. Make the UI more responsive - to give best view based on the screen-size.
5. Add support for webp image format when it becomes available in devvit (presently webp uploads are not supported).
