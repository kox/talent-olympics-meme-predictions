use anchor_lang::prelude::*;

declare_id!("8JhNshxTTss89Aii47jrfdaW6Tje1D6WdEiYRaz24fdQ");

#[program]
pub mod prediction {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        msg!("Initializing vault from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn top_up_vault(ctx: Context<TopUpVault>, amount: u64) -> Result<()> {
        let lamports_needed = amount  * 1_000_000_000;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                }
            ),
            lamports_needed
        )?;

        Ok(())
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, coin: Pubkey, price: u64, expiry: i64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        proposal.authority = *ctx.accounts.authority.key;
        proposal.coin = coin;
        proposal.price = price;
        proposal.final_price = 0;
        proposal.expiry = expiry;
        proposal.executed = false;

        Ok(())
    }

    pub fn make_prediction(ctx: Context<MakePrediction>, prediction: bool, amount: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let vault  = &mut ctx.accounts.vault;

        if proposal.executed {
            return Err(ErrorCode::ProposalEnded.into());
        }

        let clock: Clock = Clock::get()?;

        if proposal.expiry < clock.unix_timestamp {
            return Err(ErrorCode::ProposalExpired.into());
        }

        let user_prediction = &mut ctx.accounts.user_prediction;

        user_prediction.authority = *ctx.accounts.user.key;
        user_prediction.prediction = prediction;
        user_prediction.amount = amount;
        user_prediction.resolved = false;

        let lamports_needed = amount;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: vault.to_account_info(),
                }
            ),
            lamports_needed
        )?;

        Ok(())
    }

    pub fn settle(ctx: Context<Settle>, final_price: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        if proposal.executed {
            return Err(ErrorCode::ProposalAlreadyExecuted.into());
        }

        let clock: Clock = Clock::get()?;

        if clock.unix_timestamp < proposal.expiry {
            return Err(ErrorCode::ProposalNotExpired.into());
        }

        proposal.executed = true;
        proposal.final_price = final_price;

        Ok(())
    }

    pub fn check_and_reward(ctx: Context<CheckAndReward>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;

        if !proposal.executed {
            return Err(ErrorCode::ProposalNotExecuted.into());
        }

        let user_prediction = &mut ctx.accounts.user_prediction;
        
        if user_prediction.resolved {
            return Err(ErrorCode::PredictionAlreadyResolved.into());
        }

        let vault = &mut ctx.accounts.vault;
         
    
        if (user_prediction.prediction && proposal.final_price > proposal.price) ||
            (!user_prediction.prediction && proposal.final_price < proposal.price) {
            let payout = user_prediction.amount * 2;
    
            **vault.to_account_info().try_borrow_mut_lamports()? -= payout;
            **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;
        }
    
        user_prediction.resolved = true;
    
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init_if_needed, 
        payer = owner, 
        space = 8,
        seeds = [b"vault"], 
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TopUpVault<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(
        init, 
        payer = authority, 
        space = 8 + Proposal::INIT_SPACE
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakePrediction<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed, 
        payer = user, 
        space = 8 + UserPrediction::INIT_SPACE,
        seeds = [
            b"prediction", 
            proposal.key().as_ref(),
            user.key().as_ref(),
        ],
        bump,
    )]
    pub user_prediction: Account<'info, UserPrediction>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, has_one = authority)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckAndReward<'info> {
    #[account(mut, has_one = authority)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [b"vault"], 
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [
            b"prediction", 
            proposal.key().as_ref(),
            user.key().as_ref(),
        ],
        bump,
    )]
    pub user_prediction: Account<'info, UserPrediction>,

    /// CHECK: We are verifying that the address is the same as the prediction
    #[account(mut, address = user_prediction.authority)]
    pub user: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct Vault {}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub authority: Pubkey,
    pub coin: Pubkey, // mint public key of a meme coin
    pub price: u64,
    pub final_price: u64,
    pub expiry: i64,
    pub executed: bool,
}

#[account]
#[derive(InitSpace)]
pub struct UserPrediction {
    pub authority: Pubkey,
    pub prediction: bool, // higher -> true, lower -> false
    pub amount: u64,
    pub resolved: bool,
}


#[error_code]
pub enum ErrorCode {
    #[msg("Proposal has ended.")]
    ProposalEnded,
    #[msg("Proposal has expired and it's not possible to add predictions.")]
    ProposalExpired,
    #[msg("Proposal not settled yet.")]
    ProposalNotExecuted,
    #[msg("Proposal not expired yet.")]
    ProposalNotExpired,
    #[msg("Proposal already executed.")]
    ProposalAlreadyExecuted,
    #[msg("Prediction already resolved.")]
    PredictionAlreadyResolved,
}
