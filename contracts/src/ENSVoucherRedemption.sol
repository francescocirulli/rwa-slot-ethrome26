// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Irrevocably consumes existing non-burnable ENS prize vouchers.
/// @dev No withdrawal, upgrade, owner or arbitrary call path. This is a permanent lock, not an ERC1155 burn.
contract ENSVoucherRedemption is ERC1155Holder {
    address public immutable collection;
    address public immutable backend;
    uint256 public constant TOKEN_ID = 2;
    struct Consumption { address owner; bytes32 labelHash; uint64 blockNumber; }
    mapping(bytes32 => Consumption) public consumptions;
    event VoucherConsumed(bytes32 indexed claimId, address indexed owner, bytes32 indexed labelHash);
    error InvalidVoucher();
    constructor(address collection_, address backend_) {
        if(collection_ == address(0) || backend_ == address(0)) revert InvalidVoucher();
        collection=collection_; backend=backend_;
    }
    function authorizationHash(bytes32 claimId,address owner,bytes32 labelHash,uint64 deadline) public view returns(bytes32) {
        return keccak256(abi.encode(block.chainid,address(this),collection,TOKEN_ID,claimId,owner,labelHash,deadline));
    }
    function onERC1155Received(address,address from,uint256 id,uint256 value,bytes memory data) public override returns(bytes4) {
        if(msg.sender != collection || from == address(0) || id != TOKEN_ID || value != 1) revert InvalidVoucher();
        (bytes32 claimId,bytes32 labelHash,uint64 deadline,bytes memory signature)=abi.decode(data,(bytes32,bytes32,uint64,bytes));
        if(claimId==bytes32(0) || labelHash==bytes32(0) || block.timestamp>deadline || consumptions[claimId].owner!=address(0)) revert InvalidVoucher();
        if(ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(authorizationHash(claimId,from,labelHash,deadline)),signature)!=backend) revert InvalidVoucher();
        consumptions[claimId]=Consumption(from,labelHash,uint64(block.number));
        emit VoucherConsumed(claimId,from,labelHash);
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address,address,uint256[] memory,uint256[] memory,bytes memory) public pure override returns(bytes4) {
        revert InvalidVoucher();
    }
}
