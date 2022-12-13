'use strict';

const {
    getDefaultProvider,
    Contract,
    constants: { AddressZero },
    utils,
    BigNumber,
} = require('ethers');
const {
    utils: { deployContract },
} = require('@axelar-network/axelar-local-dev');

const { sleep } = require('../../utils');
const DistributionExecutable = require('../../artifacts/examples/call-contract-with-token/DistributionExecutable.sol/DistributionExecutable.json');
const Gateway = require('../../artifacts/@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol/IAxelarGateway.json');
const IERC20 = require('../../artifacts/@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol/IERC20.json');

async function deploy(chain, wallet) {
    console.log(`Deploying DistributionExecutable for ${chain.name}.`);
    const contract = await deployContract(wallet, DistributionExecutable, [chain.gateway, chain.gasReceiver]);
    chain.distributionExecutable = contract.address;
    console.log(`Deployed DistributionExecutable for ${chain.name} at ${chain.distributionExecutable}.`);
}

async function test(chains, wallet, options) {
    const args = options.args || [];
    const getGasPrice = options.getGasPrice;
    const source = chains.find((chain) => chain.name === (args[0] || 'Avalanche'));
    const destination = chains.find((chain) => chain.name === (args[1] || 'Fantom'));
    const amount = Math.floor(parseFloat(args[2])) * 1e6 || 10e6;
    const accounts = options.args[3].split(',');
    const message = options.args[4];

    if (accounts.length === 0) accounts.push(wallet.address);

    for (const chain of [source, destination]) {
        const provider = getDefaultProvider(chain.rpc);
        chain.wallet = wallet.connect(provider);
        chain.contract = new Contract(chain.distributionExecutable, DistributionExecutable.abi, chain.wallet);
        chain.gateway = new Contract(chain.gateway, Gateway.abi, chain.wallet);
        const usdcAddress = chain.gateway.tokenAddresses('aUSDC');
        chain.usdc = new Contract(usdcAddress, IERC20.abi, chain.wallet);
    }

    const balances = [];

    async function logAccountBalances() {
        console.log(`Source : ${wallet.address} has ${(await source.usdc.balanceOf(wallet.address)) / 1e6} aUSDC`);
        let i = 0;

        for (const account of accounts) {
            const destinationAccountBal = await destination.usdc.balanceOf(account);
            console.log(`Destination ${i + 1}: ${account} has ${destinationAccountBal / 1e6} aUSDC`);
            balances.push(destinationAccountBal / 1e6);
            i++;
        }
    }

    async function matchandLogAccountBalances() {
        console.log(`Source(After Transaction) : ${wallet.address} has ${(await source.usdc.balanceOf(wallet.address)) / 1e6} aUSDC`);
        let i = 0;

        for (const account of accounts) {
            console.log(`\n------------For Account ${account}------------`);
            const destinationAccountBal = await destination.usdc.balanceOf(account);
            console.log(`Destination(Before Transaction) ${i + 1} : ${account} has ${balances[i]} aUSDC`);
            console.log(`Destination(After Transaction) ${i + 1}: ${account} has ${destinationAccountBal / 1e6} aUSDC`);

            console.log(`\tDetails of TransactionInfo `);
            console.log('\t---------------------------');
            const recipientsCount = (await destination.contract.recipientsTransactionCounter(account)).toNumber();

            for (let count = 0; count < recipientsCount; count++) {
                const transactionInfo = await destination.contract.recipientsToTransactions(account, count);
                console.log(`\tSender\t\t : ${transactionInfo.sender}`);
                console.log(`\tTokenAddress\t : ${transactionInfo.tokenAddress}`);
                console.log(`\tAmount\t\t : ${transactionInfo.amount.toNumber() / 1e6}`);
                console.log(`\tMessage\t\t : ${transactionInfo.message}`);
            }

            i++;
        }
    }

    console.log('\n--- Initially ---');
    await logAccountBalances();

    const gasLimit = 3e7;
    const gasPrice = await getGasPrice(source, destination, AddressZero);

    const approveTx = await source.usdc.approve(source.contract.address, amount);
    await approveTx.wait();

    const sendTx = await source.contract.sendToMany(
        destination.name,
        destination.distributionExecutable,
        accounts,
        'aUSDC',
        amount,
        message,
        {
            value: BigInt(Math.floor(gasLimit * gasPrice)),
        },
    );
    await sendTx.wait(1);
    console.log(`Transaction Hash : ${sendTx.hash}`);
    console.log('\n--- Waiting Period Started ---');
    let allBalancesMatched = false;
    let waitTimeInMin = 0;

    while (!allBalancesMatched) {
        let i = 0;
        let pendingMatch = false;

        await sleep(60000);
        waitTimeInMin++;
        process.stdout.write(`\rWaited for ${waitTimeInMin} minutes`);

        for (const account of accounts) {
            const accountBalance = (await destination.usdc.balanceOf(account)) / 1e6;

            if (accountBalance == balances[i]) {
                pendingMatch = true;
            }

            i++;
        }

        allBalancesMatched = !pendingMatch;
    }

    console.log('\n--- After ---');
    await matchandLogAccountBalances();
}

module.exports = {
    deploy,
    test,
};
