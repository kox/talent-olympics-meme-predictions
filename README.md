# Talent Olympics: DAO Voting

This is a Solana program that implements a prediction market for meme coin prices. Users can create proposals predicting whether the price of a specific meme coin will be higher or lower within a specified timeframe. 

Other users can make predictions on the proposal, and at the end of the timeframe, the proposal creator can settle the proposal, determining the final price. 

The proposal creator will send the rewards to the users who predictions are correct, otherwise it will resolve and keep the money.

## Features

- Initialize Vault: Initialize the vault to store SOL for rewarding the users.
- Topup Vault: Add SOL to the vault for rewarding correct predictions.
- Create Proposal: Create a new proposal predicting whether a meme coin price will be higher or lower.
- Make prediction: Users can make predictions on the created proposal.
- Settle proposal: After the proposal expiry, the proposal creator can settle the proposal by providing the final price.
- Check and reward: check their predictions and send the rewards if their predictions are correct.

## Accounts
* Vault
* Proposal
* UserPrediction

## Prerequisites

- Rust
- Solana CLI
- Anchor CLI
- Node.js
- Pnpm or Yarn or npm

## Installation

Clone the repository:

```bash
git clone https://github.com/kox/talent-olympics-dao-voting
cd talent-olympics-dao-voting
```

Install dependencies:

```bash
pnpm i
```

Build the program:

```bash
anchor build
```

Run the tests:

```bash
anchor test
```

Deploy the program:

```bash
anchor deploy
```

### Usage

Check the tests where provides all information to use each instruction and the expected data.


### Youtube video

