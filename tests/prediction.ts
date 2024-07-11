import * as anchor from "@coral-xyz/anchor";

import { Prediction } from "../target/types/prediction";
import { assert } from "chai";
import { PublicKey } from '@solana/web3.js';
import { makeKeypairs, confirmTransaction } from '@solana-developers/helpers';
import { setTimeout } from 'timers/promises';

async function airdropSOL(provider, publicKey, amount) {
  const signature = await provider.connection.requestAirdrop(publicKey, amount);
  await confirmTransaction(provider.connection, signature);
}

describe("prediction", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.Prediction as anchor.Program<Prediction>;

  let [vaultPda, vaultPdaBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  const bonkPubkey = new anchor.web3.PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');;
  const bonkPrice = new anchor.BN(2616);
  const finalPriceHigher = new anchor.BN(5616);
  const finalPriceLower = new anchor.BN(1616);
  const predictionAmount = 1 * anchor.web3.LAMPORTS_PER_SOL;

  // Add your test here. 
  it("Is initialized the vault and topup with SOL!", async () => {
    // Add your test here.
    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    const initBalance = await provider.connection.getBalance(vaultPda);

    await program.methods
      .topUpVault(new anchor.BN(5))
      .accounts({
        owner: provider.wallet.publicKey,
      })
      .rpc();

    const finalBalance = await provider.connection.getBalance(vaultPda);

    // We verify that the balance has been raised without counting the minimum rent
    assert.equal(finalBalance - initBalance, 5* anchor.web3.LAMPORTS_PER_SOL)
  });

  it('Is created a new proposal for BONK memecoin!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);

    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    await program.methods
      .topUpVault(new anchor.BN(5))
      .accounts({
        owner: provider.wallet.publicKey,
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime + 60))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    const proposalData = await program.account.proposal.fetch(proposalAccount.publicKey);

    assert.equal(proposalData.authority.toString(), provider.wallet.publicKey.toString());
    assert.equal(proposalData.coin.toString(), bonkPubkey.toString());
    assert.equal(proposalData.price.toNumber(), bonkPrice.toNumber());
    assert.equal(proposalData.finalPrice.toNumber(), 0);
    assert.equal(proposalData.executed, false);
    assert.equal(proposalData.expiry.toNumber(), currentBlocktime + 60);
  });

  it('Is created a prediction (higher) for BONK memecoin!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    
    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    await program.methods
      .topUpVault(new anchor.BN(2))
      .accounts({
        owner: provider.wallet.publicKey,
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime + 60))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    const walletBalance = await provider.connection.getBalance(provider.wallet.publicKey);

    await program.methods
      .makePrediction(true, new anchor.BN(predictionAmount)) // higher and 1 SOL
      .accounts({
        proposal: proposalAccount.publicKey,
        user: provider.wallet.publicKey,
      })
      .rpc();

    const [predictionPda, bump] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("prediction"),
        proposalAccount.publicKey.toBuffer(),
        provider.wallet.publicKey.toBuffer(),
      ],
      program.programId
    );

    const predictionAccount = await program.account.userPrediction.fetch(predictionPda);

    assert.equal(predictionAccount.authority.toString(), provider.wallet.publicKey.toString());
    assert.ok(predictionAccount.prediction);
    assert.equal(predictionAccount.amount.toNumber(), predictionAmount);
    assert.notOk(predictionAccount.resolved);

    // Validating balances
    const latestVaultBalance = await provider.connection.getBalance(vaultPda);
    const latestWalletBalance = await provider.connection.getBalance(provider.wallet.publicKey);

    assert.equal(latestVaultBalance, vaultBalance + predictionAmount);
    assert(latestWalletBalance < walletBalance - predictionAmount); // it will lose some extra lamport via fees
  });

  it("should fail if it's already expired", async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    
    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();


    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime)) // we don't give time 
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    try {
      await program.methods
        .makePrediction(true, new anchor.BN(predictionAmount)) // higher and 1 SOL
        .accounts({
          proposal: proposalAccount.publicKey,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log('it should not be seen this message');
    } catch(err) {
      assert.equal(err.error.errorCode.code, 'ProposalExpired');
      assert.equal(err.error.errorMessage, "Proposal has expired and it's not possible to add predictions.");
    }
  });

  it('should settle a proposal with a final price!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    
    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    await program.methods
      .settle(finalPriceHigher)
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

      const proposalData = await program.account.proposal.fetch(proposalAccount.publicKey);

      assert.equal(proposalData.finalPrice.toNumber(), finalPriceHigher.toNumber());
      assert.equal(proposalData.executed, true);
  });

  it('should fail to settle an already executed proposal!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    
    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    await program.methods
      .settle(finalPriceHigher)
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();


    try {
      await program.methods
      .settle(finalPriceHigher)
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

      console.log('warning! this message should not be visible due error');
    } catch(err) {
      assert.equal(err.error.errorCode.code, 'ProposalAlreadyExecuted');
      assert.equal(err.error.errorMessage, "Proposal already executed.");
    }
  });

  
  it('should send the rewards for the winners (higher)!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    const keypairs = makeKeypairs(2);

    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    await program.methods
      .topUpVault(new anchor.BN(5))
      .accounts({
        owner: provider.wallet.publicKey,
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime + 5))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    for(let i=0; i< keypairs.length; i++) {
      await airdropSOL(provider, keypairs[i].publicKey, predictionAmount * 2);

      await program.methods
        .makePrediction(i == 0, new anchor.BN(predictionAmount))
        .accounts({
          proposal: proposalAccount.publicKey,
          user: keypairs[i].publicKey,
        })
        .signers([keypairs[i]])
        .rpc();
    }

    await setTimeout(6000);

    await program.methods
      .settle(finalPriceHigher)
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    for(let i=0; i< keypairs.length; i++) {
      const vaultBalance = await provider.connection.getBalance(vaultPda);
      const userBalance = await provider.connection.getBalance(keypairs[i].publicKey);

      await program.methods
        .checkAndReward()
        .accounts({
          proposal: proposalAccount.publicKey,
          user: keypairs[i].publicKey,
          authority: provider.wallet.publicKey,
          /* vault: vaultPda, */
        })
        .rpc();

        const latestVaultBalance = await provider.connection.getBalance(vaultPda);
        const latestUserBalance = await provider.connection.getBalance(keypairs[i].publicKey);

        if (i == 0) { // higher -> win
          assert.equal(latestUserBalance, userBalance + 2 * predictionAmount);
          assert.equal(latestVaultBalance, vaultBalance - 2 * predictionAmount);
        } else { // lost money
          assert.equal(latestUserBalance, userBalance);
          assert.equal(latestVaultBalance, vaultBalance);
        }

        const [predictionPda, bump] = await PublicKey.findProgramAddressSync(
          [
            Buffer.from("prediction"),
            proposalAccount.publicKey.toBuffer(),
            keypairs[i].publicKey.toBuffer(),
          ],
          program.programId
        );

        const predictionAccount = await program.account.userPrediction.fetch(predictionPda);

        assert.ok(predictionAccount.resolved);
      }
  });

  it('should send the rewards for the winners (lower)!', async () => {
    const currentSlot = await program.provider.connection.getSlot();
    const currentBlocktime = await program.provider.connection.getBlockTime(currentSlot);
    const keypairs = makeKeypairs(2);

    await program.methods
      .initializeVault()
      .accounts({
        owner: provider.wallet.publicKey
      })
      .rpc();

    await program.methods
      .topUpVault(new anchor.BN(5))
      .accounts({
        owner: provider.wallet.publicKey,
      })
      .rpc();

    const proposalAccount = anchor.web3.Keypair.generate();

    await program.methods
      .createProposal(bonkPubkey, bonkPrice, new anchor.BN(currentBlocktime + 5))
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey
      })
      .signers([proposalAccount])
      .rpc();

    for(let i=0; i< keypairs.length; i++) {
      await airdropSOL(provider, keypairs[i].publicKey, predictionAmount * 2);

      await program.methods
        .makePrediction(i == 0, new anchor.BN(predictionAmount))
        .accounts({
          proposal: proposalAccount.publicKey,
          user: keypairs[i].publicKey,
        })
        .signers([keypairs[i]])
        .rpc();
    }

    await setTimeout(6000);

    await program.methods
      .settle(finalPriceLower)
      .accounts({
        proposal: proposalAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    for(let i=0; i< keypairs.length; i++) {
      const vaultBalance = await provider.connection.getBalance(vaultPda);
      const userBalance = await provider.connection.getBalance(keypairs[i].publicKey);

      await program.methods
        .checkAndReward()
        .accounts({
          proposal: proposalAccount.publicKey,
          user: keypairs[i].publicKey,
          authority: provider.wallet.publicKey,
          /* vault: vaultPda, */
        })
        .rpc();

        const latestVaultBalance = await provider.connection.getBalance(vaultPda);
        const latestUserBalance = await provider.connection.getBalance(keypairs[i].publicKey);

        if (i == 1) { // lower -> win
          assert.equal(latestUserBalance, userBalance + 2 * predictionAmount);
          assert.equal(latestVaultBalance, vaultBalance - 2 * predictionAmount);
        } else { // lost money
          assert.equal(latestUserBalance, userBalance);
          assert.equal(latestVaultBalance, vaultBalance);
        }

        const [predictionPda, bump] = await PublicKey.findProgramAddressSync(
          [
            Buffer.from("prediction"),
            proposalAccount.publicKey.toBuffer(),
            keypairs[i].publicKey.toBuffer(),
          ],
          program.programId
        );

        const predictionAccount = await program.account.userPrediction.fetch(predictionPda);

        assert.ok(predictionAccount.resolved);
      }
  });
});
