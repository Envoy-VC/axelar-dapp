//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import { AxelarExecutable } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/executables/AxelarExecutable.sol';
import { IAxelarGateway } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol';
import { IERC20 } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol';
import { IAxelarGasService } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol';

contract DistributionExecutable is AxelarExecutable {
    IAxelarGasService public immutable gasReceiver;

    // TransactionInfo struct to store transaction details
    struct TransactionInfo {
        address sender;
        address tokenAddress;
        uint256 amount;
        string message;
    }

    // Mapping to store transaction details for each recipient

    mapping(address => TransactionInfo[]) public recipientsToTransactions;

    // Mapping to store number of transactions for each recipient
    mapping(address => uint256) public recipientsTransactionCounter;

    constructor(address gateway_, address gasReceiver_) AxelarExecutable(gateway_) {
        gasReceiver = IAxelarGasService(gasReceiver_);
    }

    function sendToMany(
        string memory destinationChain,
        string memory destinationAddress,
        address[] calldata destinationAddresses,
        string memory symbol,
        uint256 amount,
        string memory message // Added message parameter
    ) external payable {
        address tokenAddress = gateway.tokenAddresses(symbol);
        IERC20(tokenAddress).transferFrom(msg.sender, address(this), amount);
        IERC20(tokenAddress).approve(address(gateway), amount);
        bytes memory payload = abi.encode(destinationAddresses, message, msg.sender); // <-- updated payload to include message
        if (msg.value > 0) {
            gasReceiver.payNativeGasForContractCallWithToken{ value: msg.value }(
                address(this),
                destinationChain,
                destinationAddress,
                payload,
                symbol,
                amount,
                msg.sender
            );
        }
        gateway.callContractWithToken(destinationChain, destinationAddress, payload, symbol, amount);
    }

    function _executeWithToken(
        string calldata,
        string calldata,
        bytes calldata payload,
        string calldata tokenSymbol,
        uint256 amount
    ) internal override {
        (address[] memory recipients, string memory message, address sender) = abi.decode(payload, (address[], string, address)); // Decoding payload to get message and sender
        address tokenAddress = gateway.tokenAddresses(tokenSymbol);
        uint256 sentAmount = amount / recipients.length;
        for (uint256 i = 0; i < recipients.length; i++) {
            IERC20(tokenAddress).transfer(recipients[i], sentAmount);
            TransactionInfo memory txnInfo = TransactionInfo(sender, tokenAddress, sentAmount, message); // Create TransactionInfo struct
            recipientsToTransactions[recipients[i]].push(txnInfo); // Store TransactionInfo struct in mapping
            recipientsTransactionCounter[recipients[i]]++; // Increment transaction counter for recipient
        }
    }
}
